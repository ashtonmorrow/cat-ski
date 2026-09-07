// Manual artwork export; no effect on the game's runtime or build process.
// Requires Node.js with playwright and sharp available. Run from any directory:
//   node scripts/render-artwork.cjs
// Uses the game's current drawing functions and default tabby/Alps palettes.
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');

async function main() {
  const source = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  const section = (start, end) => {
    const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
    if (a < 0 || b < 0) throw new Error(`Game renderer not found: ${start}`);
    return source.slice(a, b);
  };
  const game = [
    section('  const CAT_PALETTES =', '  let catColor'),
    section('  const MOUNTAIN_SHAPES =', '  let mtnTheme'),
    section('  function drawSpruce(', '  function drawLodgepolePine('),
    section('  function drawFlag(', '  function drawMogul('),
    section('  function drawCat(', '  // Breed palettes.'),
    section('  const DOG_BREEDS =', '  function drawParticles('),
  ].join('\n');
  const browser = await chromium.launch({headless:true});
  let assets;
  try {
    const page = await browser.newPage();
    assets = await page.evaluate(game => {
      const renderer = function () {
        const mtnTheme = 'alps', H = 180, keys = {down:false};
        const curTheme = () => THEMES.alps;
        const cat = () => CAT_PALETTES.tabby;
        const toScreenY = y => y;
        let ctx, player, yeti, snowman;
        const px = (x,y,color) => {ctx.fillStyle=color;ctx.fillRect(Math.round(x),Math.round(y),1,1);};
        const canvas = (w,h) => {const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
        const catColors = ['#9a7446','#5c3d1e','#d6b889','#6ed26b','#c06a50','#f0a0a6','#0b1320','#ffffff','#000000','#2a1a0e','#5a3a1f','#8a6538','#c8a060','#ff3b30','#444444'];
        const themeColors = ['#bcd1e3','#e6ecf2','#e7edf3','#9aacbe','#5e6e82','#2c3848','#3d8a4f','#266a37','#143d1e','#0a2410','#5a3a1f','#2a1708','#ffffff','#222222','#ff3b30','#ffcc00','#b6cde0','#8fb0c8','#a06d2a','#caa050','#1a0e06','#e0b070','#e8c188','#ff6b8a','#1a0a0a','#d68888','#c8102e','#000000','#dfe9f2','#0b1320','#ff7a18'];
        // Resolve fractional vector edges onto a small, opaque pixel grid.
        // No gradients, intermediate edge colors, or blurred scaling survive.
        function hardPixels(c, colors) {
          const g=c.getContext('2d'), data=g.getImageData(0,0,c.width,c.height);
          const rgb=[...new Set(colors)].map(hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)));
          for(let p=0;p<data.data.length;p+=4){
            if(data.data[p+3]<128){data.data[p+3]=0;continue;}
            let best=rgb[0], distance=Infinity;
            for(const candidate of rgb){const d=candidate.reduce((sum,v,i)=>sum+(v-data.data[p+i])**2,0);if(d<distance){distance=d;best=candidate;}}
            data.data.set([...best,255],p);
          }
          g.putImageData(data,0,0);return c;
        }
        const sprite=(w,h,draw,colors=themeColors)=>{const c=canvas(w,h);ctx=c.getContext('2d');draw();return hardPixels(c,colors);};
        const skier=sprite(40,40,()=>{
          player={x:19,screenY:15,angle:0,airHeight:0,air:0,crashed:false,invincT:0,trick:null,trickFrames:0,trickElapsed:0};
          drawSkier();
        },catColors);
        const face=sprite(16,16,()=>drawCat(ctx,8,13,1,CAT_PALETTES.tabby,{pose:'front'}),catColors);
        const tree=sprite(24,28,()=>drawSpruce(12,14));
        const dog=sprite(28,28,()=>{yeti={x:13,y:10,rage:0};drawYeti();});
        const snow=sprite(28,36,()=>{snowman={x:14,y:18,bob:0,chompT:0};drawSnowman();});
        const flagL=sprite(10,14,()=>drawFlag(3,10,'L'));
        const flagR=sprite(10,14,()=>drawFlag(3,10,'R'));
        const ramp=sprite(36,12,()=>drawJump(18,7,false));
        const scene=canvas(240,180);ctx=scene.getContext('2d');
        const T=curTheme();
        ctx.fillStyle=T.sky.top;ctx.fillRect(0,0,240,180);
        ctx.fillStyle=T.sky.bottom;ctx.fillRect(0,24,240,24);
        drawMountain(ctx,MOUNTAIN_SHAPES.montblanc,-5,48,32,T.peakColors[0]);
        drawMountain(ctx,MOUNTAIN_SHAPES.matterhorn,62,48,43,T.peakColors[1]);
        drawMountain(ctx,MOUNTAIN_SHAPES.eiger,121,48,36,T.peakColors[2]);
        drawMountain(ctx,MOUNTAIN_SHAPES.montblanc,151,48,28,T.peakColors[0]);
        ctx.fillStyle=T.slope;ctx.fillRect(0,48,240,132);
        // Reuse the snow fleck/track geometry from the game's snowfield.
        ctx.fillStyle=T.fleck;
        for(let i=0;i<28;i++)ctx.fillRect((i*97)%240,78+(i*53)%98,1,1);
        ctx.fillStyle='rgba(130,160,185,0.55)';
        for(let y=93;y<164;y+=4){ctx.fillRect(174,y,1,2);ctx.fillRect(184,y,1,2);}
        hardPixels(scene,themeColors);
        ctx.imageSmoothingEnabled=false;
        const place=(s,x,y,scale=1)=>ctx.drawImage(s,x,y,s.width*scale,s.height*scale);
        place(tree,24,78);place(tree,108,94);place(tree,214,130);
        place(tree,-4,138,2);place(tree,94,159);
        place(flagL,137,136,2);place(flagR,216,104,2);
        place(ramp,127,162);
        place(snow,205,30);
        place(dog,191,70);
        place(skier,139,78,2);
        const social=canvas(240,126);social.getContext('2d').drawImage(scene,0,27,240,126,0,0,240,126);
        const icon=canvas(48,48), ig=icon.getContext('2d');
        ig.fillStyle=T.slope;ig.fillRect(0,0,48,48);ig.drawImage(skier,4,4);
        const mask=canvas(64,64), mg=mask.getContext('2d');
        mg.fillStyle=T.slope;mg.fillRect(0,0,64,64);mg.drawImage(skier,12,12);
        const favicon=canvas(16,16), fg=favicon.getContext('2d');
        fg.fillStyle=T.slope;fg.fillRect(0,0,16,16);fg.drawImage(face,0,0);
        return Object.fromEntries(Object.entries({scene,social,icon,mask,favicon,skier}).map(([key,c])=>[key,c.toDataURL('image/png').split(',')[1]]));
      };
      const body=renderer.toString().replace('{',()=>'{\n'+game+'\n');
      const render=new Function('document',`return (${body})();`);
      // Drawing functions and their state share this scope; they are copied
      // directly from index.html, rather than maintaining a second cat design.
      return render(document);
    }, game);
  } finally {await browser.close();}
  const write=async(key,name,size)=>sharp(Buffer.from(assets[key],'base64')).resize(size.width,size.height,{kernel:'nearest'}).png({palette:true,colours:64,dither:0}).toFile(path.join(root,name));
  await write('scene','title-scene.png',{width:1200,height:900});
  await write('social','preview.png',{width:1200,height:630});
  for(const [name,size] of [['icon-192.png',192],['icon-512.png',512],['apple-touch-icon.png',180],['cat-ski-browser.png',1024]])await write('icon',name,{width:size,height:size});
  await write('mask','icon-maskable-512.png',{width:512,height:512});
  for(const size of [16,32,48,64])await write('favicon',`favicon-${size}.png`,{width:size,height:size});
  const frames=await Promise.all([16,32,48].map(size=>fs.readFile(path.join(root,`favicon-${size}.png`))));
  const header=Buffer.alloc(6+frames.length*16);header.writeUInt16LE(1,2);header.writeUInt16LE(frames.length,4);
  let offset=header.length;
  frames.forEach((frame,i)=>{const p=6+i*16;header[p]=header[p+1]=[16,32,48][i];header.writeUInt16LE(1,p+4);header.writeUInt16LE(32,p+6);header.writeUInt32LE(frame.length,p+8);header.writeUInt32LE(offset,p+12);offset+=frame.length;});
  await fs.writeFile(path.join(root,'favicon.ico'),Buffer.concat([header,...frames]));
  console.log('Exported title, social, and icon artwork from the tabby/Alps game renderers.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
