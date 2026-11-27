// Renders dist/jamo-templates.json from Noto Sans KR (SIL Open Font License).
// Usage: node make-jamo-templates.mjs [path-to-NotoSansKR.ttf]
import {createCanvas,GlobalFonts} from '@napi-rs/canvas';
import {writeFileSync} from 'node:fs';
import {SHAPES,inkMask,glyphVector} from './dist/jamo-shape.mjs';

const font=process.argv[2]||'C:/Windows/Fonts/NotoSansKR-VF.ttf';
GlobalFonts.registerFromPath(font,'TemplateKR');
const SIZE=40;

function dilate(mask,r){
 if(!r)return mask;
 const {ink,width,height}=mask,out=new Uint8Array(ink.length);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  if(!ink[y*width+x])continue;
  for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const yy=y+dy,xx=x+dx;if(yy>=0&&xx>=0&&yy<height&&xx<width)out[yy*width+xx]=1;}
 }
 return {ink:out,width,height};
}
const render=(ch,angle,thick)=>{
 const c=createCanvas(SIZE*3,SIZE*3),ctx=c.getContext('2d');
 ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
 ctx.translate(c.width/2,c.height/2);ctx.rotate(angle*Math.PI/180);
 ctx.fillStyle='#000';ctx.font=`${SIZE}px TemplateKR`;ctx.textBaseline='middle';ctx.textAlign='center';
 ctx.fillText(ch,0,0);
 return glyphVector(dilate(inkMask(ctx.getImageData(0,0,c.width,c.height)),thick),0,c.width);
};
const templates={};
for(const ch of SHAPES){
 templates[ch]=[];
 for(const angle of [-6,0,6])for(const thick of [0,1,2]){
  const g=render(ch,angle,thick),digit=render('6',0,thick);
  if(g)templates[ch].push({aspect:+g.aspect.toFixed(3),rel:+(g.width/digit.height).toFixed(3),field:Array.from(g.field,v=>Math.min(9,Math.round(v*9))).join('')});
 }
}
writeFileSync('dist/jamo-templates.json',JSON.stringify(templates));
console.log('templates',Object.keys(templates).length);
