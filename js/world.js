import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ASSETS = {
  roadAlbedo:'assets/env/road/albedo.jpg', roadNormal:'assets/env/road/normal.jpg', roadRough:'assets/env/road/roughness.jpg',
  barrierDiff:'assets/env/barrier/diff.jpg', barrierNormal:'assets/env/barrier/nor_gl.jpg', barrierRough:'assets/env/barrier/rough.jpg',
  grass:'assets/env/terrain-grass.jpg', rockTex:'assets/env/terrain-rock.jpg',
  treeA:'assets/env/tree-pine-a.glb', treeB:'assets/env/tree-pine-b.glb',
  rockA:'assets/env/rock-a.glb', rockB:'assets/env/rock-b.glb',
  building:'assets/env/building-a.glb', mountainFar:'assets/env/mountain-far.glb',
  bannerA:'assets/env/banner-a.png', bannerB:'assets/env/banner-b.png', chevron:'assets/env/sign-chevron.png',
  startline:'assets/env/startline_checker.jpg', curb:'assets/env/curb_stripes.jpg'
};

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function hash2(x,y){let h=Math.imul(x|0,374761393)+Math.imul(y|0,668265263);h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296;}
function vnoise(x,y){const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi;const u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);
  const a=hash2(xi,yi),b=hash2(xi+1,yi),c=hash2(xi,yi+1),d=hash2(xi+1,yi+1);
  return (a*(1-u)+b*u)*(1-v)+(c*(1-u)+d*u)*v;}
function fbm(x,y){return vnoise(x,y)*0.6+vnoise(x*2.13,y*2.13)*0.28+vnoise(x*4.37,y*4.37)*0.12;}
function smoothstep(a,b,x){const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);}

export async function buildWorld(scene, quality, onProgress){
  const prog = onProgress || function(){};
  const q = quality || {};
  const rng = mulberry32(7);
  const loader = new GLTFLoader();
  const texLoader = new THREE.TextureLoader();
  let done = 0; const TOTAL = 19;
  const step = l => { done++; prog(Math.min(1, done/TOTAL), l); };
  const safe = async (p, label) => { try { const r = await p; step(label); return r; } catch(e){ console.warn('[world] asset failed:', label, e && e.message); step(label); return null; } };
  const loadTex = (url, srgb) => new Promise((res,rej)=>texLoader.load(url, t=>{
    if(srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; res(t);
  }, undefined, rej));
  const loadGLB = url => new Promise((res,rej)=>loader.load(url, res, undefined, rej));

  prog(0.02,'loading assets');
  const jobs = {
    roadAlbedo: safe(loadTex(ASSETS.roadAlbedo,true),'road albedo'),
    roadNormal: safe(loadTex(ASSETS.roadNormal,false),'road normal'),
    roadRough:  safe(loadTex(ASSETS.roadRough,false),'road rough'),
    barrierDiff: safe(loadTex(ASSETS.barrierDiff,true),'barrier diff'),
    barrierNormal: safe(loadTex(ASSETS.barrierNormal,false),'barrier normal'),
    barrierRough: safe(loadTex(ASSETS.barrierRough,false),'barrier rough'),
    grass:      safe(loadTex(ASSETS.grass,true),'grass'),
    rockTex:    safe(loadTex(ASSETS.rockTex,true),'rock'),
    treeA:      safe(loadGLB(ASSETS.treeA),'treeA'),
    treeB:      safe(loadGLB(ASSETS.treeB),'treeB'),
    rockA:      safe(loadGLB(ASSETS.rockA),'rockA'),
    rockB:      safe(loadGLB(ASSETS.rockB),'rockB'),
    building:   safe(loadGLB(ASSETS.building),'building'),
    mountainFar:safe(loadGLB(ASSETS.mountainFar),'mountainFar'),
    bannerA:    safe(loadTex(ASSETS.bannerA,true),'bannerA'),
    bannerB:    safe(loadTex(ASSETS.bannerB,true),'bannerB'),
    chevron:    safe(loadTex(ASSETS.chevron,true),'chevron'),
    startline:  safe(loadTex(ASSETS.startline,true),'startline'),
    curb:       safe(loadTex(ASSETS.curb,true),'curb')
  };
  const A = {};
  for(const k in jobs) A[k] = await jobs[k];

  // ---- TRACK SPLINE ----
  const CP = [
    [0,0,-420],[0,0,-120],[90,6,-20],[230,14,40],[350,22,120],[420,28,240],
    [400,32,340],[280,38,400],[140,44,380],[40,48,300],[-60,52,180],
    [-140,56,60],[-160,58,-80],[-120,50,-220],[-60,30,-360]
  ].map(p=>new THREE.Vector3(p[0],p[1],p[2]));
  const curve = new THREE.CatmullRomCurve3(CP, true, 'catmullrom', 0.5);
  const length = curve.getLength();
  const HW = 4.5;

  const SN = 400, SPT = [];
  for(let i=0;i<SN;i++){
    const u=i/SN, p=curve.getPointAt(u), t=curve.getTangentAt(u);
    const rl=Math.hypot(t.x,t.z)||1;
    SPT.push({x:p.x,y:p.y,z:p.z,s:u*length,tx:t.x/rl,tz:t.z/rl,rx:t.z/rl,rz:-t.x/rl});
  }
  let cx=0,cz=0; for(const p of SPT){cx+=p.x;cz+=p.z;} cx/=SN; cz/=SN;

  const nearest = (x,z)=>{let bi=0,bd=1e18;for(let i=0;i<SN;i++){const p=SPT[i];const dx=x-p.x,dz=z-p.z;const d=dx*dx+dz*dz;if(d<bd){bd=d;bi=i;}}return{bi,d:Math.sqrt(bd)};};
  const terrainHeight = (x,z)=>{
    const n = nearest(x,z), base = SPT[n.bi].y;
    const t = smoothstep(16,120,n.d);
    const m = (fbm(x*0.0032,z*0.0032)-0.5)*80 + (fbm(x*0.011,z*0.011)-0.5)*16;
    return base - 0.15 + m*t;
  };

  // ---- ROAD RIBBON ----
  const N = Math.max(64, Math.round(length/4));
  const rp=[],ru=[],rn=[],ri=[];
  for(let i=0;i<=N;i++){
    const u=i/N, p=curve.getPointAt(u), t=curve.getTangentAt(u);
    const rl=Math.hypot(t.x,t.z)||1, rx=t.z/rl, rz=-t.x/rl, s=u*length;
    rp.push(p.x-rx*HW,p.y,p.z-rz*HW, p.x+rx*HW,p.y,p.z+rz*HW);
    ru.push(0,s/8, 1,s/8);
    rn.push(0,1,0, 0,1,0);
    if(i<N){const a=i*2; ri.push(a,a+2,a+1, a+1,a+2,a+3);}
  }
  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(rp,3));
  roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(ru,2));
  roadGeo.setAttribute('normal', new THREE.Float32BufferAttribute(rn,3));
  roadGeo.setIndex(ri);
  const roadMat = new THREE.MeshStandardMaterial({ color:0xffffff, roughness:1.0, metalness:0.0, envMapIntensity:0.5 });
  if(A.roadAlbedo) roadMat.map = A.roadAlbedo;
  if(A.roadNormal){ roadMat.normalMap = A.roadNormal; roadMat.normalScale = new THREE.Vector2(0.85,0.85); }
  if(A.roadRough) roadMat.roughnessMap = A.roadRough;
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.receiveShadow = true; road.name = 'road';
  scene.add(road);

  // ---- CURBS (red/white stripe texture) ----
  const cp=[],cu=[],ci=[];
  for(let i=0;i<=N;i++){
    const u=i/N, p=curve.getPointAt(u), t=curve.getTangentAt(u);
    const rl=Math.hypot(t.x,t.z)||1, rx=t.z/rl, rz=-t.x/rl, s=u*length;
    const v = s/2; // one red+white stripe pair per 2m of track
    cp.push(p.x-rx*(HW+0.55),p.y+0.03,p.z-rz*(HW+0.55), p.x-rx*HW,p.y+0.03,p.z-rz*HW,
            p.x+rx*HW,p.y+0.03,p.z+rz*HW, p.x+rx*(HW+0.55),p.y+0.03,p.z+rz*(HW+0.55));
    cu.push(0,v, 1,v, 1,v, 0,v);
    if(i<N){const a=i*4; ci.push(a,a+4,a+1, a+1,a+4,a+5, a+2,a+6,a+3, a+3,a+6,a+7);}
  }
  const curbGeo = new THREE.BufferGeometry();
  curbGeo.setAttribute('position', new THREE.Float32BufferAttribute(cp,3));
  curbGeo.setAttribute('uv', new THREE.Float32BufferAttribute(cu,2));
  curbGeo.setIndex(ci); curbGeo.computeVertexNormals();
  const curbMat = new THREE.MeshStandardMaterial({roughness:0.85, metalness:0.0, side:THREE.DoubleSide});
  if(A.curb) curbMat.map = A.curb;
  const curbs = new THREE.Mesh(curbGeo, curbMat);
  curbs.receiveShadow = true;
  scene.add(curbs);

  // ---- START / FINISH ----
  const sp0 = curve.getPointAt(0), st0 = curve.getTangentAt(0);
  const sfGeo = new THREE.PlaneGeometry(9, 2.4); sfGeo.rotateX(-Math.PI/2);
  const sfMat = new THREE.MeshStandardMaterial({roughness:0.9, metalness:0.0});
  if(A.startline) sfMat.map = A.startline;
  const sf = new THREE.Mesh(sfGeo, sfMat);
  sf.position.set(sp0.x, sp0.y+0.02, sp0.z);
  sf.rotation.y = Math.atan2(st0.x, st0.z);
  sf.receiveShadow = true;
  scene.add(sf);

  // ---- TERRAIN ----
  const tg = new THREE.PlaneGeometry(1200,1200,128,128); tg.rotateX(-Math.PI/2);
  const tp = tg.attributes.position, hs = new Float32Array(tp.count), tc = new Float32Array(tp.count*3);
  let hmin=1e9, hmax=-1e9;
  for(let i=0;i<tp.count;i++){
    const h = terrainHeight(tp.getX(i)+cx, tp.getZ(i)+cz);
    hs[i]=h; if(h<hmin)hmin=h; if(h>hmax)hmax=h;
  }
  const span = Math.max(1, hmax-hmin);
  for(let i=0;i<tp.count;i++){
    tp.setY(i, hs[i]);
    const f = Math.min(1, Math.max(0, (hs[i]-hmin)/span));
    const v = 0.42 + 0.58*f;
    tc[i*3]=v*0.94; tc[i*3+1]=v; tc[i*3+2]=v*0.82;
  }
  tg.setAttribute('color', new THREE.BufferAttribute(tc,3));
  tg.translate(cx,0,cz); tg.computeVertexNormals();
  const grassMat = new THREE.MeshStandardMaterial({color:0xffffff, roughness:1.0, metalness:0.0, vertexColors:true});
  if(A.grass){ A.grass.repeat.set(90,90); grassMat.map = A.grass; }
  const terrain = new THREE.Mesh(tg, grassMat);
  terrain.receiveShadow = true; terrain.name = 'terrain';
  scene.add(terrain);

  // ---- DISTANT ROCK RING ----
  const rg = new THREE.RingGeometry(560,1150,96,6); rg.rotateX(-Math.PI/2);
  const rpp = rg.attributes.position;
  for(let i=0;i<rpp.count;i++){
    const x=rpp.getX(i)+cx, z=rpp.getZ(i)+cz;
    const d=Math.hypot(x-cx,z-cz);
    rpp.setY(i, (fbm(x*0.0022,z*0.0022)-0.34)*230*smoothstep(560,950,d));
  }
  rg.translate(cx,0,cz); rg.computeVertexNormals();
  const rockMat = new THREE.MeshStandardMaterial({color:0xffffff, roughness:1.0, metalness:0.0});
  if(A.rockTex){ A.rockTex.repeat.set(60,60); rockMat.map = A.rockTex; }
  const ring = new THREE.Mesh(rg, rockMat);
  ring.receiveShadow = true;
  scene.add(ring);

  // ---- PROPS ----
  const props = [];
  const dummy = new THREE.Object3D();
  // Merge every mesh in a prop GLB into one geometry (with material groups) so
  // InstancedMesh renders the WHOLE prop (trunk+leaves etc.), not just 1 mesh.
  const mergedFrom = (gltf) => {
    if(!gltf) return null;
    gltf.scene.updateMatrixWorld(true);
    const geos = [], mats = [];
    gltf.scene.traverse(o => {
      if(!o.isMesh || !o.geometry) return;
      let g = o.geometry.clone().applyMatrix4(o.matrixWorld);
      let mi = mats.indexOf(o.material);
      if(mi < 0){ mi = mats.length; mats.push(o.material); }
      g.clearGroups();
      g.addGroup(0, g.index ? g.index.count : g.attributes.position.count, mi);
      geos.push(g);
    });
    if(!geos.length) return null;
    // normalize index-ness for mergeGeometries
    const anyIndexed = geos.some(g => !!g.index);
    const norm = geos.map(g => (anyIndexed && !g.index) ? g.toNonIndexed() : ((!anyIndexed && g.index) ? g.toNonIndexed() : g));
    // drop incompatible attribute sets
    const keys = Object.keys(norm[0].attributes).sort().join(',');
    const compat = norm.filter(g => Object.keys(g.attributes).sort().join(',') === keys);
    const merged = mergeGeometries(compat.length > 1 ? compat : norm, true);
    if(!merged){
      const first = geos[0];
      return { geometry: first, materials: [mats[0] || new THREE.MeshStandardMaterial({color:0x888888})] };
    }
    return { geometry: merged, materials: mats };
  };
  const instFrom = (gltf, count) => {
    const mp = mergedFrom(gltf);
    if(!mp) return null;
    const m = new THREE.InstancedMesh(mp.geometry, mp.materials.length > 1 ? mp.materials : mp.materials[0], count);
    m.castShadow = true; m.receiveShadow = true; m.userData.max = count;
    return m;
  };
  const scatter = (mesh, count, minD, maxD, sMin, sMax) => {
    if(!mesh) return;
    for(let i=0;i<count;i++){
      const u = rng(), p = curve.getPointAt(u), t = curve.getTangentAt(u);
      const rl = Math.hypot(t.x,t.z)||1, rx=t.z/rl, rz=-t.x/rl;
      const side = rng()<0.5?-1:1, d = minD + rng()*(maxD-minD);
      const x = p.x + rx*d*side, z = p.z + rz*d*side;
      dummy.position.set(x, terrainHeight(x,z), z);
      dummy.rotation.set(0, rng()*Math.PI*2, 0);
      const s = sMin + rng()*(sMax-sMin);
      dummy.scale.set(s,s,s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh); props.push(mesh);
  };
  scatter(instFrom(A.treeA,130), 130, 12, 40, 0.8, 1.5);
  scatter(instFrom(A.treeB,120), 120, 12, 40, 0.8, 1.5);
  scatter(instFrom(A.rockA,60), 60, 12, 40, 0.6, 1.7);
  scatter(instFrom(A.rockB,60), 60, 12, 40, 0.6, 1.7);

  // buildings near start
  if(A.building){
    const mp = mergedFrom(A.building);
    if(mp){
      const bmat = mp.materials.length > 1 ? mp.materials : mp.materials[0];
      for(let i=0;i<3;i++){
        const u = 0.006 + i*0.013;
        const p = curve.getPointAt(u), t = curve.getTangentAt(u);
        const rl = Math.hypot(t.x,t.z)||1, rx=t.z/rl, rz=-t.x/rl;
        const side = (i%2)?1:-1, d = 26 + rng()*14;
        const x = p.x + rx*d*side, z = p.z + rz*d*side;
        const m = new THREE.Mesh(mp.geometry, bmat);
        m.position.set(x, terrainHeight(x,z), z);
        m.scale.set(4,4,4);
        m.rotation.y = Math.atan2(t.x,t.z) + (side>0?Math.PI:0) + (rng()-0.5)*0.4;
        m.castShadow = true; m.receiveShadow = true;
        scene.add(m);
      }
    }
  }

  // far mountains
  if(A.mountainFar){
    const mp = mergedFrom(A.mountainFar);
    if(mp){
      const mmat = mp.materials.length > 1 ? mp.materials : mp.materials[0];
      for(let i=0;i<8;i++){
        const a = (i/8)*Math.PI*2 + rng()*0.35;
        const r = 620 + rng()*280;
        const m = new THREE.Mesh(mp.geometry, mmat);
        const s = 28 + rng()*30;
        m.position.set(cx + Math.cos(a)*r, -10 + rng()*20, cz + Math.sin(a)*r);
        m.scale.set(s,s,s);
        m.rotation.y = rng()*Math.PI*2;
        scene.add(m);
      }
    }
  }

  // banners on posts near start straight
  const banners = [];
  const bannerTexs = [A.bannerA, A.bannerB].filter(Boolean);
  if(bannerTexs.length){
    const postGeo = new THREE.BoxGeometry(0.16,4.2,0.16);
    const postMat = new THREE.MeshStandardMaterial({color:0x2b2b30, roughness:0.7, metalness:0.4});
    for(let i=0;i<4;i++){
      const u = 0.008 + i*0.014;
      const p = curve.getPointAt(u), t = curve.getTangentAt(u);
      const rl = Math.hypot(t.x,t.z)||1, rx=t.z/rl, rz=-t.x/rl;
      const side = (i%2)?1:-1, d = 7.5;
      const x = p.x + rx*d*side, z = p.z + rz*d*side;
      const gy = terrainHeight(x,z);
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(x, gy+2.1, z); post.castShadow = true;
      scene.add(post);
      const bm = new THREE.Mesh(new THREE.PlaneGeometry(3.2,1.1),
        new THREE.MeshStandardMaterial({map:bannerTexs[i%bannerTexs.length], side:THREE.DoubleSide, transparent:true, roughness:0.9, metalness:0.0}));
      bm.position.set(x, gy+3.4, z);
      bm.rotation.y = Math.atan2(t.x,t.z) + Math.PI/2;
      bm.userData.baseY = gy+3.4; bm.userData.ph = rng()*6.283;
      scene.add(bm); banners.push(bm);
    }
  }

  // chevrons on corner outsides, facing oncoming traffic
  if(A.chevron){
    const cm = new THREE.MeshStandardMaterial({map:A.chevron, side:THREE.DoubleSide, transparent:true, roughness:0.8, metalness:0.0});
    const cg = new THREE.PlaneGeometry(1.6,1.6);
    for(const u of [0.16,0.30,0.44,0.58,0.72,0.86]){
      const p = curve.getPointAt(u), t = curve.getTangentAt(u);
      const rl = Math.hypot(t.x,t.z)||1, rx=t.z/rl, rz=-t.x/rl;
      for(const side of [-1,1]){
        const d = 7.2;
        const x = p.x + rx*d*side, z = p.z + rz*d*side;
        const m = new THREE.Mesh(cg, cm);
        m.position.set(x, terrainHeight(x,z)+1.2, z);
        m.rotation.y = Math.atan2(-t.x,-t.z);
        scene.add(m);
      }
    }
  }

  // ---- BARRIER WALLS (trackside concrete walls, real scanned concrete textures)
  // The 61k-tri scanned barrier unit is too heavy to instance continuously, so the
  // wall is an extruded Jersey profile surfaced with the scan's real textures.
  if(A.barrierDiff){
    const PROF = [[-0.35,0],[0.35,0],[0.2,0.5],[0.15,0.82],[-0.15,0.82],[-0.2,0.5]];
    const bmat = new THREE.MeshStandardMaterial({ roughness:1.0, metalness:0.0, envMapIntensity:0.4, side:THREE.DoubleSide });
    bmat.map = A.barrierDiff;
    if(A.barrierNormal){ bmat.normalMap = A.barrierNormal; bmat.normalScale = new THREE.Vector2(0.9,0.9); }
    if(A.barrierRough) bmat.roughnessMap = A.barrierRough;
    for(const side of [-1,1]){
      const BN = Math.max(64, Math.round(length/4));
      const bp=[], bu=[], bi=[];
      const off = side*(HW+0.85);
      for(let i=0;i<=BN;i++){
        const u=i/BN, p=curve.getPointAt(u), t=curve.getTangentAt(u);
        const rl=Math.hypot(t.x,t.z)||1, rx=t.z/rl, rz=-t.x/rl, s=u*length;
        const bx=p.x+rx*off, bz=p.z+rz*off;
        for(let j=0;j<PROF.length;j++){
          const lo=PROF[j][0], h=PROF[j][1];
          bp.push(bx+rx*lo, p.y+h, bz+rz*lo);
          bu.push(s/3, j/(PROF.length-1));
        }
        if(i<BN){ const a=i*PROF.length, b=(i+1)*PROF.length;
          for(let j=0;j<PROF.length-1;j++){ bi.push(a+j,b+j,a+j+1, a+j+1,b+j,b+j+1); } }
      }
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute(bp,3));
      bg.setAttribute('uv', new THREE.Float32BufferAttribute(bu,2));
      bg.setIndex(bi); bg.computeVertexNormals();
      const wall = new THREE.Mesh(bg, bmat);
      wall.castShadow = true; wall.receiveShadow = true;
      scene.add(wall);
    }
  }

  // ---- LIGHTING ----
  const az = THREE.MathUtils.degToRad(252), el = THREE.MathUtils.degToRad(10);
  const sun = new THREE.DirectionalLight(0xffb070, 2.6);
  sun.position.set(cx + Math.cos(el)*Math.sin(az)*500, Math.sin(el)*500, cz + Math.cos(el)*Math.cos(az)*500);
  sun.target.position.set(cx, 0, cz);
  sun.castShadow = true;
  const sms = q.shadowMapSize || 2048;
  sun.shadow.mapSize.set(sms, sms);
  const sc = sun.shadow.camera;
  sc.left = -170; sc.right = 170; sc.top = 170; sc.bottom = -170; sc.near = 1; sc.far = 1600;
  sun.shadow.bias = -0.0006;
  scene.add(sun); scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(0x9db8ff, 0x4a3a28, 0.55);
  scene.add(hemi);
  if(!scene.fog) scene.fog = new THREE.Fog(0xf0a878, 600, 2400);

  // ---- TRACK API ----
  const track = {
    length,
    startPose: { position:{x:sp0.x, y:sp0.y, z:sp0.z}, heading: Math.atan2(-st0.x, -st0.z) },
    halfWidthAt: () => HW,
    tangentAt: (s) => {
      const u = (((s % length) + length) % length) / length;
      const t = curve.getTangentAt(u);
      return { x:t.x, y:t.y, z:t.z };
    },
    checkpoints: [length*0.25, length*0.5, length*0.75],
    pointAt: (s) => {
      const u = (((s % length) + length) % length) / length;
      const p = curve.getPointAt(u);
      return { x: p.x, y: p.y, z: p.z };
    },
    groundHeightAt: (x,z) => terrainHeight(x,z),
    project: (pos) => {
      let bi = 0, bd = 1e18;
      for(let i=0;i<SN;i++){
        const p = SPT[i], dx = pos.x-p.x, dz = pos.z-p.z, d = dx*dx+dz*dz;
        if(d < bd){ bd = d; bi = i; }
      }
      let best = null;
      for(let k=-1;k<=1;k++){
        const i0 = (bi+k+SN)%SN, i1 = (i0+1)%SN;
        const a = SPT[i0], b = SPT[i1];
        const abx = b.x-a.x, abz = b.z-a.z;
        const L2 = abx*abx + abz*abz || 1e-6;
        let tt = ((pos.x-a.x)*abx + (pos.z-a.z)*abz) / L2;
        tt = Math.max(0, Math.min(1, tt));
        const px = a.x + abx*tt, pz = a.z + abz*tt;
        const dx = pos.x-px, dz = pos.z-pz;
        const d2 = dx*dx + dz*dz;
        if(!best || d2 < best.d2){
          const inv = 1/Math.sqrt(L2);
          const tx = abx*inv, tz = abz*inv;
          best = { d2, s: a.s + tt*(length/SN), lateral: dx*tz - dz*tx, tx, tz };
        }
      }
      return { s: best.s, lateral: best.lateral, tangent: { x: best.tx, z: best.tz } };
    }
  };

  // ---- UPDATE / DENSITY ----
  let time = 0;
  function update(dt){
    time += dt;
    for(let i=0;i<banners.length;i++){
      const b = banners[i];
      b.rotation.z = Math.sin(time*2.2 + b.userData.ph) * 0.09;
      b.position.y = b.userData.baseY + Math.sin(time*1.7 + b.userData.ph) * 0.05;
    }
  }
  function setPropDensity(f){
    const k = Math.min(1, Math.max(0, f));
    for(let i=0;i<props.length;i++){
      const m = props[i];
      m.count = Math.max(0, Math.floor(m.userData.max * k));
      m.visible = m.count > 0;
    }
  }

  prog(1, 'world ready');
  return { track, sunLight: sun, update, setPropDensity };
}