/* Double Trouble V4 - original, dependency-free WebGL2 renderer.
 * All geometry and surface detail are generated locally. No network or asset loader.
 * Coordinates: V3 board units, scoring radius 192; saved y points down, world y up.
 * Picking uses the board/backstop planes, never the darts or raised wires.
 */
(() => {
  'use strict';
  const ORDER = [20,1,18,4,13,6,10,15,2,17,3,19,7,16,8,11,14,9,12,5];
  const PI=Math.PI, TAU=PI*2;
  const add=(a,b)=>a.map((v,i)=>v+b[i]), sub=(a,b)=>a.map((v,i)=>v-b[i]);
  const mul=(a,s)=>a.map(v=>v*s), dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const norm=a=>mul(a,1/(Math.hypot(...a)||1));
  const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
  const rgb=h=>[1,3,5].map(n=>parseInt(h.slice(n,n+2),16)/255);
  const ident=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  function model(p,axis=[0,0,1],roll=0,scale=1){
    const z=norm(axis), x0=norm(cross(Math.abs(z[1])>.99?[1,0,0]:[0,1,0],z)), y0=cross(z,x0);
    const x=add(mul(x0,Math.cos(roll)),mul(y0,Math.sin(roll))), y=add(mul(y0,Math.cos(roll)),mul(x0,-Math.sin(roll)));
    return new Float32Array([x[0]*scale,x[1]*scale,x[2]*scale,0,y[0]*scale,y[1]*scale,y[2]*scale,0,z[0]*scale,z[1]*scale,z[2]*scale,0,...p,1]);
  }
  function perspective(fov,aspect,near,far,z){
    const f=1/Math.tan(fov/2), a=(far+near)/(near-far), b=2*far*near/(near-far);
    return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,a,-1,0,0,b-a*z,z]);
  }
  function geometry(){return {p:[],n:[],uv:[]};}
  function tri(g,a,b,c,n=null,uv=[[0,0],[0,0],[0,0]]){
    const N=n||norm(cross(sub(b,a),sub(c,a)));g.p.push(...a,...b,...c);g.n.push(...N,...N,...N);g.uv.push(...uv.flat());
  }
  function quad(g,a,b,c,d,n=null){tri(g,a,b,c,n);tri(g,a,c,d,n);}
  function segment(g,r0,r1,a0,a1,z=0,steps=12){
    for(let i=0;i<steps;i++){let a=a0+(a1-a0)*i/steps,b=a0+(a1-a0)*(i+1)/steps;
      quad(g,[r0*Math.cos(a),r0*Math.sin(a),z],[r1*Math.cos(a),r1*Math.sin(a),z],[r1*Math.cos(b),r1*Math.sin(b),z],[r0*Math.cos(b),r0*Math.sin(b),z],[0,0,1]);}
  }
  function tube(g,a,b,r,steps=10){
    const ax=norm(sub(b,a)), u=norm(cross(Math.abs(ax[2])>.99?[0,1,0]:[0,0,1],ax)),v=cross(ax,u);
    for(let i=0;i<steps;i++){const n0=add(mul(u,Math.cos(TAU*i/steps)),mul(v,Math.sin(TAU*i/steps))),n1=add(mul(u,Math.cos(TAU*(i+1)/steps)),mul(v,Math.sin(TAU*(i+1)/steps)));
      const p0=add(a,mul(n0,r)),p1=add(a,mul(n1,r)),p2=add(b,mul(n1,r)),p3=add(b,mul(n0,r));
      const verts=[p0,p1,p2,p0,p2,p3],ns=[n0,n1,n1,n0,n1,n0];verts.forEach((p,j)=>{g.p.push(...p);g.n.push(...ns[j]);g.uv.push(0,0);});}
  }
  function torus(g,R,r,z,steps=180,minor=8){
    const point=(a,b)=>[(R+r*Math.cos(b))*Math.cos(a),(R+r*Math.cos(b))*Math.sin(a),z+r*Math.sin(b)];
    const normal=(a,b)=>[Math.cos(b)*Math.cos(a),Math.cos(b)*Math.sin(a),Math.sin(b)];
    for(let i=0;i<steps;i++)for(let j=0;j<minor;j++){
      const a=TAU*i/steps,b=TAU*(i+1)/steps,c=TAU*j/minor,d=TAU*(j+1)/minor;
      const vs=[[a,c],[b,c],[b,d],[a,c],[b,d],[a,d]];vs.forEach(([u,v])=>{g.p.push(...point(u,v));g.n.push(...normal(u,v));g.uv.push(0,0);});}
  }
  function lathe(g,profile,sides=24){
    for(let j=0;j<profile.length-1;j++){
      const [z0,r0]=profile[j],[z1,r1]=profile[j+1],slope=(r0-r1)/Math.max(.01,z1-z0);
      for(let i=0;i<sides;i++){
        const a=TAU*i/sides,b=TAU*(i+1)/sides;
        const verts=[[r0*Math.cos(a),r0*Math.sin(a),z0],[r0*Math.cos(b),r0*Math.sin(b),z0],[r1*Math.cos(b),r1*Math.sin(b),z1],[r1*Math.cos(a),r1*Math.sin(a),z1]];
        const ns=[norm([Math.cos(a),Math.sin(a),slope]),norm([Math.cos(b),Math.sin(b),slope])];
        [0,1,2,0,2,3].forEach(k=>{g.p.push(...verts[k]);g.n.push(...ns[k===0||k===3?0:1]);g.uv.push(0,0);});}
    }
  }
  const VS=`#version 300 es
  precision highp float;
  in vec3 aPosition; in vec3 aNormal; in vec2 aUV;
  uniform mat4 uModel,uVP; uniform float uShadow,uShadowZ;
  out vec3 vWorld,vNormal; out vec2 vUV;
  void main(){vec4 w=uModel*vec4(aPosition,1.);vNormal=normalize(mat3(uModel)*aNormal);vUV=aUV;
    if(uShadow>0.5){float h=max(0.,w.z-uShadowZ);w.xy-=vec2(-.40,.55)*h;w.z=uShadowZ+.10;}
    vWorld=w.xyz;gl_Position=uVP*w;}`;
  const FS=`#version 300 es
  precision highp float;
  in vec3 vWorld,vNormal; in vec2 vUV;
  uniform vec3 uColor,uEye; uniform float uMetal,uRough,uKind,uAlpha,uShadow,uShadowZ;
  uniform sampler2D uTexture; out vec4 outColor;
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float ggx(float ndh,float a){float a2=a*a,d=ndh*ndh*(a2-1.)+1.;return a2/(3.14159*d*d+.00001);}
  vec3 lighting(vec3 albedo,vec3 N,vec3 V,vec3 L,vec3 radiance,float rough,float metal){
    vec3 H=normalize(V+L);float nl=max(dot(N,L),0.),nv=max(dot(N,V),.001),nh=max(dot(N,H),0.),hv=max(dot(H,V),0.);
    vec3 F0=mix(vec3(.04),albedo,metal),F=F0+(1.-F0)*pow(1.-hv,5.);
    float k=pow(rough+1.,2.)/8.,G=nv/(nv*(1.-k)+k)*nl/(nl*(1.-k)+k);
    vec3 spec=ggx(nh,max(.04,rough*rough))*G*F/max(.01,4.*nv*nl);
    return ((1.-F)*(1.-metal)*albedo/3.14159+spec)*radiance*nl;
  }
  void main(){
    float alpha=uAlpha;vec3 base=uColor,N=normalize(vNormal);
    if(uShadow>.5){float radius=length(vWorld.xy);if(uShadowZ> -5. && radius>244.)discard;if(uShadowZ< -5. && radius<244.)discard;outColor=vec4(0.,0.,0.,alpha);return;}
    if(uKind>3.5 && uKind<4.5){vec4 t=texture(uTexture,vUV);alpha*=t.a;if(alpha<.01)discard;base=t.rgb;}
    if(uKind>4.5 && uKind<5.5){outColor=vec4(base,alpha);return;}
    if(uKind>5.5){float d=length(vUV-.5)*2.;alpha*=1.-smoothstep(.74,1.,d);outColor=vec4(0.,0.,0.,alpha);return;}
    if(uKind>.5 && uKind<1.5){
      float grain=hash(floor(vWorld.xy*vec2(2.5,.9))),grain2=hash(floor(vWorld.xy*vec2(.23,.6)));
      float fiber=sin(vWorld.x*7.+sin(vWorld.y*.13)*2.);base*=.955+grain*.055+grain2*.022;
      N=normalize(N+vec3(fiber*.010,(grain-.5)*.025,0.));
    }else if(uKind>1.5 && uKind<2.5){float g=hash(floor(vWorld.xy*1.5));base*=.975+g*.045;}
    else if(uKind>2.5 && uKind<3.5){base*=.93+.07*sin(vWorld.z*6.);}
    vec3 a=pow(max(base,vec3(0.)),vec3(2.2)),V=normalize(uEye-vWorld);
    vec3 col=a*(.30+.09*max(N.y,0.));
    col+=lighting(a,N,V,normalize(vec3(-.62,.8,1.)),vec3(2.75,2.64,2.4),uRough,uMetal);
    col+=lighting(a,N,V,normalize(vec3(.9,.2,1.)),vec3(.62,.72,.86),uRough,uMetal);
    col+=lighting(a,N,V,normalize(vec3(0.,-1.,.6)),vec3(.35,.39,.42),uRough,uMetal);
    if(uMetal>.4){vec3 R=reflect(-V,N);float strip=pow(max(0.,1.-abs(R.x+.4)),10.);col+=mix(vec3(.055),vec3(.75),strip)*mix(vec3(.6),a,.35)*uMetal;}
    col=col/(vec3(1.)+col*.25);outColor=vec4(pow(max(col,vec3(0.)),vec3(1./2.2)),alpha);
  }`;

  class DartStage {
    constructor(host,options={}){
      this.host=host;this.options=options;this.darts=new Map();this.meshes=[];this.materials=[];this.resources=[];
      this.raf=0;this.visible=true;this.disposed=false;this.effect=null;this.motion='realistic';this.mode='3d';this.aim=null;
      this.canvas=document.createElement('canvas');this.canvas.className='dart-canvas';this.canvas.tabIndex=0;
      this.canvas.setAttribute('role','application');this.canvas.setAttribute('aria-label','Dartboard and backstop. Click to record a dart. Arrow keys aim, Enter records. Shift for precision.');
      host.append(this.canvas);
      this.gl=this.canvas.getContext('webgl2',{alpha:false,antialias:true,powerPreference:'low-power',preserveDrawingBuffer:false});
      try {if(!this.gl)throw Error('WebGL2 unavailable');this.initGL();this.buildBoard();this.buildDart();}
      catch(err){console.warn('3D unavailable; using the scoring-safe 2D view.',err);this.fallback(err.message);}
      this.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();if(!this.disposed)this.fallback('Graphics context lost');});
      this.bindPointer();this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(host);this.resize();
      this.visibilityHandler=()=>{this.visible=!document.hidden&&this.host.isConnected;if(this.visible)this.invalidate();};
      document.addEventListener('visibilitychange',this.visibilityHandler);
    }
    initGL(){
      const gl=this.gl,compile=(type,code)=>{const s=gl.createShader(type);gl.shaderSource(s,code);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
      const v=compile(gl.VERTEX_SHADER,VS),f=compile(gl.FRAGMENT_SHADER,FS),p=gl.createProgram();gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(f);
      if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));this.program=p;gl.useProgram(p);this.uniforms={};
      ['Model','VP','Shadow','ShadowZ','Color','Eye','Metal','Rough','Kind','Alpha','Texture'].forEach(k=>this.uniforms[k]=gl.getUniformLocation(p,'u'+k));
      this.attributes=['Position','Normal','UV'].map(k=>gl.getAttribLocation(p,'a'+k));
      gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.disable(gl.CULL_FACE);
      this.whiteTexture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.whiteTexture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]));
    }
    upload(g,material){
      const gl=this.gl,vao=gl.createVertexArray();gl.bindVertexArray(vao);const buffers=[];
      [g.p,g.n,g.uv].forEach((arr,i)=>{const b=gl.createBuffer();buffers.push(b);gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(arr),gl.STATIC_DRAW);gl.enableVertexAttribArray(this.attributes[i]);gl.vertexAttribPointer(this.attributes[i],i===2?2:3,gl.FLOAT,false,0,0);});
      gl.bindVertexArray(null);const mesh={vao,buffers,count:g.p.length/3,material};this.resources.push(mesh);return mesh;
    }
    material(color,metal=0,rough=.8,kind=0,alpha=1){return {color:rgb(color),metal,rough,kind,alpha};}
    boardMesh(g,mat){const mesh=this.upload(g,mat);this.meshes.push(mesh);return mesh;}
    buildBoard(){
      const back=geometry();quad(back,[-3000,-3000,-25],[3000,-3000,-25],[3000,3000,-25],[-3000,3000,-25],[0,0,1]);this.boardMesh(back,this.material('#9bb6a6',0,.95,2));
      // A soft contact shadow underneath the raised board body.
      const sh=geometry();tri(sh,[-278,-286,-24.8],[292,-286,-24.8],[292,284,-24.8],[0,0,1],[[0,0],[1,0],[1,1]]);tri(sh,[-278,-286,-24.8],[292,284,-24.8],[-278,284,-24.8],[0,0,1],[[0,0],[1,1],[0,1]]);this.boardMesh(sh,this.material('#000000',0,1,6,.65));
      const casing=geometry();lathe(casing,[[-23,235],[-19,244],[-3,244],[-.6,241]],192);segment(casing,0,242,0,TAU,-.7,240);this.boardMesh(casing,this.material('#111616',.18,.68));
      const mats=['#e5e1d0','#262e28','#519e75','#ef695c'].map(c=>this.material(c,0,.86,1)),gs=mats.map(()=>geometry());
      ORDER.forEach((_,i)=>{const a=(81-i*18)*PI/180,b=(99-i*18)*PI/180;[[18,108],[108,120],[120,180],[180,192]].forEach(([r0,r1],j)=>segment(gs[j%2===0?i%2:2+i%2],r0,r1,a,b,0,12));});
      segment(gs[2],0,18,0,TAU,0,90);segment(gs[3],0,7.5,0,TAU,.02,60);gs.forEach((g,i)=>this.boardMesh(g,mats[i]));
      const wires=geometry();[7.5,18,108,120,180,192].forEach(r=>torus(wires,r,.40,.45,Math.max(50,Math.round(r)),8));
      for(let i=0;i<20;i++){const a=(81-i*18)*PI/180;tube(wires,[18*Math.cos(a),18*Math.sin(a),.45],[192*Math.cos(a),192*Math.sin(a),.45],.36,8);}
      torus(wires,242,1.3,-.1,220,10);torus(wires,199,.7,.3,180,8);this.boardMesh(wires,this.material('#8b9493',.80,.41));
      const nums=document.createElement('canvas');nums.width=nums.height=1024;const ctx=nums.getContext('2d');ctx.translate(512,512);ctx.scale(2,2);ctx.font='600 17px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#e2e0d3';
      ORDER.forEach((n,i)=>{const a=(-90+i*18)*PI/180;ctx.fillText(n,Math.cos(a)*216,Math.sin(a)*216+1);});
      const gl=this.gl,tex=gl.createTexture();this.numberTexture=tex;gl.bindTexture(gl.TEXTURE_2D,tex);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,nums);gl.generateMipmap(gl.TEXTURE_2D);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      const g=geometry();tri(g,[-256,-256,1.6],[256,-256,1.6],[256,256,1.6],[0,0,1],[[0,0],[1,0],[1,1]]);tri(g,[-256,-256,1.6],[256,256,1.6],[-256,256,1.6],[0,0,1],[[0,0],[1,1],[0,1]]);const mat=this.material('#ffffff',.15,.55,4);mat.texture=tex;this.boardMesh(g,mat);
      const pulse=geometry();segment(pulse,.986,1,0,TAU,0,128);this.pulseMesh=this.upload(pulse,this.material('#d9eb9b',0,1,5,.35));
      const reticle=geometry();segment(reticle,.78,1,0,TAU,0,32);this.reticleMesh=this.upload(reticle,this.material('#f4efe0',0,1,5,1));
    }
    buildDart(){
      const steel=geometry(),black=geometry(),fins=geometry(),decal=geometry();
      lathe(steel,[[0,.09],[25,.85],[27,2.2],[29,3.7]],22);
      const profile=[[28,3.7]];for(let z=30;z<=65;z+=2.5)profile.push([z,3.9],[z+.7,3.9],[z+1,3.1],[z+1.8,3.1]);profile.push([68,3.5],[71,2.]);lathe(steel,profile,28);
      lathe(black,[[70,1.5],[76,1.65],[78,1.9],[98,1.6],[126,.8]],18);
      lathe(steel,[[76,1.9],[79,1.9]],18);
      const poly=[[0,89],[12,99],[15,117],[6,133],[0,127]];
      // Four fin surfaces with closed edges, not billboard sprites.
      for(let i=0;i<4;i++){
        const a=i*PI/2,dir=[Math.cos(a),Math.sin(a),0],normal=[-Math.sin(a),Math.cos(a),0];
        const P=(p,off)=>add([dir[0]*p[0],dir[1]*p[0],p[1]],mul(normal,off));
        for(const off of [-.24,.24])for(let j=1;j<poly.length-1;j++)tri(fins,P(poly[0],off),P(poly[j],off),P(poly[j+1],off),mul(normal,off>0?1:-1));
        for(let j=0;j<poly.length;j++)quad(fins,P(poly[j],-.24),P(poly[(j+1)%poly.length],-.24),P(poly[(j+1)%poly.length],.24),P(poly[j],.24));
        const stripe=[[2,111],[13.1,112],[14.0,115],[2,115]];
        for(const off of [-.30,.30])quad(decal,P(stripe[0],off),P(stripe[1],off),P(stripe[2],off),P(stripe[3],off),mul(normal,off>0?1:-1));
      }
      this.dartMeshes=[this.upload(steel,this.material('#b6bec1',.88,.27,3)),this.upload(black,this.material('#181c20',.38,.44)),this.upload(fins,this.material('#edb564',.15,.52)),this.upload(decal,this.material('#202728',.10,.6))];
    }
    fallback(reason){
      if(this.mode==='2d')return;this.mode='2d';this.fallbackReason=reason;
      if(this.raf)cancelAnimationFrame(this.raf);this.raf=0;
      const old=this.canvas;this.canvas=old.cloneNode(false);old.replaceWith(this.canvas);this.ctx=this.canvas.getContext('2d');
      if(this.bound)this.bindPointer();this.gl=null;this.options.onFallback?.(reason);this.resize();
    }
    bindPointer(){
      this.bound=true;
      this.canvas.addEventListener('pointermove',e=>{const p=this.pick(e.clientX,e.clientY);this.aim=p;this.options.onHover?.(p);this.invalidate();});
      this.canvas.addEventListener('pointerleave',()=>{this.aim=null;this.options.onHover?.(null);this.invalidate();});
      this.canvas.addEventListener('click',e=>{if(e.button!==0)return;const p=this.pick(e.clientX,e.clientY);if(p)this.options.onThrow?.(p);});
      this.canvas.addEventListener('keydown',e=>{
        if(e.ctrlKey||e.metaKey||e.altKey)return;
        if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
          e.preventDefault();let p=this.aim||{x:0,y:0};const step=e.shiftKey?1:5;p={x:p.x+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0),y:p.y+(e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0)};
          p.x=Math.max(-this.viewW/2+10,Math.min(this.viewW/2-10,p.x));p.y=Math.max(-this.viewH/2+10,Math.min(this.viewH/2-10,p.y));this.aim=p;this.options.onHover?.(p);this.invalidate();
        }else if(e.key==='Enter'||e.key===' '){e.preventDefault();this.options.onThrow?.(this.aim||{x:0,y:0});}
      });
    }
    resize(){
      if(this.disposed||!this.host)return;const r=this.host.getBoundingClientRect();if(r.width<2||r.height<2)return;
      this.width=r.width;this.height=r.height;const dpr=Math.min(window.devicePixelRatio||1,this.quality==='eco'?1:1.75);
      this.canvas.width=Math.round(r.width*dpr);this.canvas.height=Math.round(r.height*dpr);
      this.aspect=r.width/r.height;this.viewH=Math.max(526,526/this.aspect);this.viewW=this.viewH*this.aspect;
      this.camZ=this.viewH/(2*Math.tan(32*PI/360));this.invalidate();
    }
    pick(clientX,clientY){
      const r=this.canvas.getBoundingClientRect();if(!r.width||!r.height)return null;
      const nx=(clientX-r.left)/r.width-.5,ny=(clientY-r.top)/r.height-.5;
      if(Math.abs(nx)>.5||Math.abs(ny)>.5)return null;
      let x=nx*this.viewW,y=ny*this.viewH;
      if(Math.hypot(x,y)>244){const s=(this.camZ+25)/this.camZ;x*=s;y*=s;}
      return {x,y};
    }
    project(x,y){
      const z=Math.hypot(x,y)>244?-25:0,s=this.camZ/(this.camZ-z),r=this.canvas.getBoundingClientRect();
      return {x:r.left+(x*s/this.viewW+.5)*r.width,y:r.top+(y*s/this.viewH+.5)*r.height};
    }
    setOptions({motion,quality}={}){this.motion=motion||'realistic';if(quality&&this.quality!==quality){this.quality=quality;this.resize();}}
    duration(){return this.motion==='reduced'?0:this.motion==='quick'?230:470;}
    shotKey(s,i){return s.id||`${s.at||0}:${i}:${s.x}:${s.y}`;}
    setDarts(shots,{animateId=null,clear=false}={}){
      this.lastShots=shots;const wanted=new Set();let created=false;
      shots.forEach((shot,i)=>{
        if(!Number.isFinite(shot.x)||!Number.isFinite(shot.y))return;const key=this.shotKey(shot,i);wanted.add(key);
        if(this.darts.has(key)){const d=this.darts.get(key);if(d.exiting){d.exiting=0;d.p=d.end;d.flight=false;d.hit=true;}return;}
        const end=[shot.x,-shot.y,(Math.hypot(shot.x,shot.y)>244?-25:0)-.4];
        const axis=norm([[.23,-.50,1],[.40,-.43,1],[.17,-.64,1]][i%3]);
        const animate=key===animateId&&this.duration()>0;
        const dart={key,shot,index:i,end,axis,p:end,roll:.4+i*.24,start:performance.now(),flight:animate,hit:!animate,exiting:0};
        if(animate){dart.startP=[end[0]*.4+90,end[1]*.2-190,this.camZ*.64];dart.p=dart.startP;created=true;}
        this.darts.set(key,dart);
      });
      for(const [key,d]of this.darts)if(!wanted.has(key)){
        if(clear&&this.duration()>0&&!d.exiting){d.exiting=performance.now();d.exitP=d.p.slice();d.flight=false;}
        else if(!d.exiting)this.darts.delete(key);
      }
      this.invalidate();return created;
    }
    cancelAnimations(){for(const [k,d]of this.darts){if(d.exiting)this.darts.delete(k);else {d.flight=false;d.hit=true;d.p=d.end;}}this.effect=null;this.invalidate();}
    effectFor(type){if(this.motion==='reduced')return;this.effect={type,start:performance.now()};this.invalidate();}
    invalidate(){if(this.disposed||!this.visible||!this.host.isConnected||this.raf)return;this.raf=requestAnimationFrame(t=>{this.raf=0;this.frame(t);});}
    frame(t){
      if(this.disposed||!this.visible||!this.width)return;
      let moving=false;const duration=this.duration();
      for(const [key,d]of this.darts){
        if(d.exiting){const v=(t-d.exiting)/190;if(v>=1){this.darts.delete(key);continue;}d.p=add(d.exitP,[v*5,-v*20,v*210]);moving=true;continue;}
        if(d.flight){
          const elapsed=t-d.start,q=duration?Math.min(1,elapsed/duration):1;
          if(q<1){const u=1-q,p0=d.startP,p1=add(d.startP,[0,115,-170]),p2=add(d.end,mul(d.axis,94)); // Endpoint tangent matches the embedded shaft: no impact flip.
            d.p=add(add(mul(p0,u*u*u),mul(p1,3*u*u*q)),add(mul(p2,3*u*q*q),mul(d.end,q*q*q)));
            const velocity=add(add(mul(sub(p1,p0),3*u*u),mul(sub(p2,p1),6*u*q)),mul(sub(d.end,p2),3*q*q));
            d.flightAxis=norm(mul(velocity,-1));moving=true;
          }else{
            d.p=d.end;
            if(!d.hit){d.hit=true;this.options.onImpact?.(d.shot);}
            const settle=elapsed-duration;d.flightAxis=norm(add(d.axis,[Math.sin(settle*.063)*.048*Math.exp(-settle/48),Math.sin(settle*.063)*.065*Math.exp(-settle/48),0]));
            if(settle<140&&duration){moving=true;}else{d.flight=false;d.flightAxis=null;this.options.onSettled?.(d.shot);}
          }
        }
      }
      if(this.effect){if(t-this.effect.start>1100)this.effect=null;else moving=true;}
      if(this.mode==='3d'){try{this.draw3D(t);}catch(e){this.fallback(e.message);}}
      else this.draw2D(t);
      if(moving)this.invalidate();
    }
    drawMesh(mesh,M=ident(),overrides={}){
      const gl=this.gl,mat={...mesh.material,...overrides},u=this.uniforms;
      gl.bindVertexArray(mesh.vao);gl.uniformMatrix4fv(u.Model,false,M);gl.uniform3fv(u.Color,mat.color);gl.uniform1f(u.Metal,mat.metal);gl.uniform1f(u.Rough,mat.rough);gl.uniform1f(u.Kind,mat.kind);gl.uniform1f(u.Alpha,mat.alpha);
      gl.uniform1f(u.Shadow,mat.shadow?1:0);gl.uniform1f(u.ShadowZ,mat.shadowZ||0);
      gl.bindTexture(gl.TEXTURE_2D,mat.texture||this.whiteTexture);gl.drawArrays(gl.TRIANGLES,0,mesh.count);
    }
    draw3D(t){
      const gl=this.gl;gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clearColor(.61,.714,.651,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(this.program);
      const z=this.camZ;gl.uniformMatrix4fv(this.uniforms.VP,false,perspective(32*PI/180,this.aspect,2,6000,z));gl.uniform3fv(this.uniforms.Eye,[0,0,z]);
      this.meshes.forEach(m=>this.drawMesh(m));
      for(const d of this.darts.values()){
        const M=model(d.p,d.flightAxis||d.axis,d.roll),opacity=d.exiting?Math.max(0,1-(t-d.exiting)/190):1;
        if(!d.flight||d.hit){gl.depthMask(false);for(const shadowZ of [0,-25])for(const m of this.dartMeshes)this.drawMesh(m,M,{shadow:true,shadowZ,alpha:.105*opacity});gl.depthMask(true);}
        this.dartMeshes.forEach((m,i)=>this.drawMesh(m,M,{alpha:opacity,...(i===2?{color:rgb(/^#[0-9a-f]{6}$/i.test(d.shot.dartColor)?d.shot.dartColor:'#d9eb9b')}:{})}));
      }
      if(this.effect&&['bullseye','outerbull','180','win'].includes(this.effect.type)){
        const p=(t-this.effect.start)/1100,wide=['180','win'].includes(this.effect.type),r=wide?244+p*8:10+p*52;
        gl.depthMask(false);this.drawMesh(this.pulseMesh,model([0,0,2],[0,0,1],0,r),{alpha:Math.max(0,.45*(1-p)),color:rgb(wide?'#d9eb9b':'#efb46b')});gl.depthMask(true);
      }
      if(this.aim){const p=this.aim,zp=Math.hypot(p.x,p.y)>244?-24:2;gl.depthMask(false);this.drawMesh(this.reticleMesh,model([p.x,-p.y,zp],[0,0,1],0,3.8),{alpha:.8,color:rgb('#f4efe0')});gl.depthMask(true);}
    }
    draw2D(t){
      if(!this.ctx)return;const c=this.ctx,w=this.canvas.width,h=this.canvas.height,k=h/this.viewH;c.setTransform(1,0,0,1,0,0);c.fillStyle='#9bb6a6';c.fillRect(0,0,w,h);c.translate(w/2,h/2);c.scale(k,k);
      c.fillStyle='#111615';c.shadowColor='#000';c.shadowBlur=18;c.shadowOffsetY=8;c.beginPath();c.arc(0,0,244,0,TAU);c.fill();c.shadowBlur=0;c.shadowOffsetY=0;
      ORDER.forEach((n,i)=>{const a=(-99+i*18)*PI/180,b=a+18*PI/180;[[18,108],[108,120],[120,180],[180,192]].forEach(([r0,r1],j)=>{c.fillStyle=j%2?(i%2?'#ef695c':'#519e75'):(i%2?'#262e28':'#e5e1d0');c.beginPath();c.arc(0,0,r1,a,b);c.arc(0,0,r0,b,a,true);c.closePath();c.fill();c.lineWidth=.65;c.strokeStyle='#89928c';c.stroke();});const ang=(-90+i*18)*PI/180;c.fillStyle='#e2dfd5';c.font='600 17px Arial';c.textAlign='center';c.textBaseline='middle';c.fillText(n,Math.cos(ang)*216,Math.sin(ang)*216);});
      for(const [r,color]of [[18,'#519e75'],[7.5,'#ef695c']]){c.beginPath();c.arc(0,0,r,0,TAU);c.fillStyle=color;c.fill();c.stroke();}
      for(const d of this.darts.values()){const p=d.p,scale=this.camZ/(this.camZ-p[2]),x=p[0]*scale,y=-p[1]*scale,tailX=x+(20+d.index*11)*scale,tailY=y+(47+d.index*5)*scale;c.lineCap='round';c.strokeStyle='#0b0c0c';c.lineWidth=5;c.beginPath();c.moveTo(x+4,y+5);c.lineTo(tailX+8,tailY+7);c.stroke();c.strokeStyle='#b8c1c4';c.lineWidth=3*scale;c.beginPath();c.moveTo(x,y);c.lineTo(tailX,tailY);c.stroke();c.fillStyle=d.shot.dartColor||'#d9eb9b';c.beginPath();c.moveTo(tailX,tailY+10*scale);c.lineTo(tailX-9*scale,tailY-8*scale);c.lineTo(tailX+4*scale,tailY-15*scale);c.lineTo(tailX+12*scale,tailY+2*scale);c.closePath();c.fill();}
      if(this.aim){c.strokeStyle='#f4f1e8';c.lineWidth=1;c.beginPath();c.arc(this.aim.x,this.aim.y,4,0,TAU);c.stroke();}
    }
    pause(){this.visible=false;if(this.raf)cancelAnimationFrame(this.raf);this.raf=0;this.cancelAnimations();}
    resume(){this.visible=true;this.resize();this.invalidate();}
    debug(){return {mode:this.mode,darts:[...this.darts.values()].filter(d=>!d.exiting).map(d=>({id:d.key,x:d.end[0],y:-d.end[1],z:d.end[2],color:d.shot.dartColor,flying:d.flight})),buffers:this.resources.length,canvas:[this.canvas.width,this.canvas.height]};}
    dispose(){this.disposed=true;if(this.raf)cancelAnimationFrame(this.raf);this.observer?.disconnect();document.removeEventListener('visibilitychange',this.visibilityHandler);if(this.gl){const gl=this.gl;this.resources.forEach(m=>{m.buffers.forEach(b=>gl.deleteBuffer(b));gl.deleteVertexArray(m.vao);});gl.deleteTexture(this.whiteTexture);gl.deleteTexture(this.numberTexture);gl.deleteProgram(this.program);gl.getExtension('WEBGL_lose_context')?.loseContext();}this.canvas.remove();this.darts.clear();}
  }
  window.DoubleTroubleStage=DartStage;
})();
