import express from 'express';
import multer from 'multer';
import ffmpegStatic from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const app = express();
const upload = multer({ dest: path.join(os.tmpdir(), 'sermon-shorts-uploads'), limits: { fileSize: 2 * 1024 * 1024 * 1024 } });
const ffmpegPath = process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg';

app.use((req,res,next)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.get('/health',(_req,res)=>res.json({ok:true}));

function assTime(seconds) {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(c).padStart(2,'0')}`;
}

function cleanAssText(value='') {
  return String(value)
    .replace(/<[^>]*>/g,'')
    .replace(/\r?\n/g,' ')
    .replace(/\{/g,'(')
    .replace(/\}/g,')')
    .replace(/\\/g,'')
    .trim();
}

function wrapKorean(text, max=18) {
  const src = cleanAssText(text);
  if (src.length <= max) return src;
  const words = src.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (!line) { line = word; continue; }
    if ((line + ' ' + word).length <= max) line += ' ' + word;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.slice(0,3).join('\\N');
}

function makeAss(items, clipStart, clipEnd, hook) {
  const relevant = items.filter(x => x.start < clipEnd && (x.start + x.duration) > clipStart);
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Hook,Noto Sans CJK KR,54,&H0000C8FF,&H0000C8FF,&H00111111,&H70000000,-1,0,0,0,100,100,0,0,1,4,1,8,90,90,170,1\nStyle: Caption,Noto Sans CJK KR,46,&H00FFFFFF,&H00FFFFFF,&H00111111,&H70000000,-1,0,0,0,100,100,0,0,1,4,1,2,70,70,190,1\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n`;
  const lines = [];
  if (hook) {
    lines.push(`Dialogue: 1,${assTime(0)},${assTime(Math.min(4.2, clipEnd-clipStart))},Hook,,0,0,0,,${wrapKorean(hook,16)}`);
  }
  for (const x of relevant) {
    const start = Math.max(0, Number(x.start) - clipStart);
    const end = Math.min(clipEnd - clipStart, Math.max(start + 0.8, Number(x.start) + Number(x.duration || 1) - clipStart));
    const text = wrapKorean(x.text, 22);
    if (text) lines.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Caption,,0,0,0,,${text}`);
  }
  return header + lines.join('\n') + '\n';
}

function escapeFilterPath(p) {
  return p.replace(/\\/g,'/').replace(/:/g,'\\:').replace(/'/g,"\\'");
}

async function cleanup(paths) {
  await Promise.all(paths.map(p => fs.rm(p,{force:true}).catch(()=>{})));
}

app.post('/render', upload.single('video'), async (req,res) => {
  if (!req.file) return res.status(400).json({error:'video file required'});
  const start = Number(req.body.start || 0);
  const end = Number(req.body.end || 60);
  const layout = req.body.layout === 'crop' ? 'crop' : 'blur';
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    await cleanup([req.file.path]);
    return res.status(400).json({error:'invalid start/end'});
  }

  let transcript = [];
  try { transcript = JSON.parse(req.body.transcript || '[]'); } catch {}

  const id = crypto.randomBytes(6).toString('hex');
  const out = path.join(os.tmpdir(), `sermon-short-${id}.mp4`);
  const assPath = path.join(os.tmpdir(), `sermon-short-${id}.ass`);
  const duration = Math.min(180, end - start);
  const hook = cleanAssText(req.body.hook || req.body.title || '');
  const ass = makeAss(transcript, start, end, hook);
  await fs.writeFile(assPath, ass, 'utf8');

  const escaped = escapeFilterPath(assPath);
  let filter;
  if (layout === 'crop') {
    filter = `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,subtitles='${escaped}'[v]`;
  } else {
    filter = `[0:v]split=2[bg0][fg0];` +
      `[bg0]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=28,eq=brightness=-0.18[bg];` +
      `[fg0]scale=1080:1920:force_original_aspect_ratio=decrease[fg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,subtitles='${escaped}'[v]`;
  }

  const args = [
    '-y','-ss',String(start),'-i',req.file.path,'-t',String(duration),
    '-filter_complex',filter,'-map','[v]','-map','0:a?','-c:v','libx264','-preset','veryfast','-crf','21',
    '-c:a','aac','-b:a','160k','-movflags','+faststart','-pix_fmt','yuv420p',out
  ];

  const proc = spawn(ffmpegPath, args, { stdio: ['ignore','ignore','pipe'] });
  let stderr='';
  proc.stderr.on('data',d=>stderr+=d.toString());
  proc.on('error', async (err)=>{
    await cleanup([req.file.path,assPath,out]);
    if (!res.headersSent) res.status(500).json({error:'ffmpeg 실행 실패',detail:String(err)});
  });
  proc.on('close', async (code)=>{
    if (res.headersSent) return;
    if (code !== 0) {
      await cleanup([req.file.path,assPath,out]);
      return res.status(500).json({error:'ffmpeg failed', detail:stderr.slice(-2200)});
    }
    res.download(out, 'sermon-short.mp4', async ()=>{
      await cleanup([out,assPath,req.file.path]);
    });
  });
});

const port = Number(process.env.PORT || 8787);
app.listen(port, ()=>console.log(`render worker listening on ${port}`));
