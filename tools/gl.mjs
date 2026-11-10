import puppeteer from 'puppeteer-core';
for (const args of [['--use-angle=gl','--enable-gpu','--ignore-gpu-blocklist'],['--use-angle=swiftshader','--enable-unsafe-swiftshader']]) {
  try {
    const b = await puppeteer.launch({executablePath:'/usr/local/bin/chromium',headless:true,args:['--no-sandbox',...args]});
    const p = await b.newPage();
    const r = await p.evaluate(()=>{const c=document.createElement('canvas');const g=c.getContext('webgl2');if(!g)return 'no webgl2';const e=g.getExtension('WEBGL_debug_renderer_info');return g.getParameter(e?e.UNMASKED_RENDERER_WEBGL:g.RENDERER)+' | floatRT='+!!g.getExtension('EXT_color_buffer_float');});
    console.log(args[0],'=>',r); await b.close();
  } catch(e){console.log(args[0],'ERR',e.message.slice(0,200));}
}
