export const DEFAULT_CAR_CONFIG={mass:1500,wheelBase:2.9,lf:1.45,lr:1.45,trackWidth:1.9,carHalfWidth:1.0,engineForce:13500,brakeForce:22000,dragCoeff:0.62,rollResist:14,maxSteerAngle:0.55,steerSpeed:4.5,speedsPerGear:[0,16,27,40,55,72,95],finalDrive:3.4,wheelRadius:0.34,nitroForce:9000,nitroCapacity:1,latGrip:{B:9.5,C:1.35,D:1.05},Iz:2600,offTrackDrag:1.8};

export function basisFromHeading(heading){const s=Math.sin(heading),c=Math.cos(heading);return{forward:{x:-s,z:-c},right:{x:c,z:-s}};}

const G=9.81;
const clamp=(v,a,b)=>(v<a?a:(v>b?b:v));
const num=(v,d)=>(typeof v==='number'&&isFinite(v)?v:d);

export function createVehicle(config,trackQuery){
  const cfg=Object.assign({},DEFAULT_CAR_CONFIG,config||{});
  const lg=Object.assign({},DEFAULT_CAR_CONFIG.latGrip,cfg.latGrip||{});
  const lf=num(cfg.lf,cfg.wheelBase/2),lr=num(cfg.lr,cfg.wheelBase/2);
  const FzF=cfg.mass*G*lr/cfg.wheelBase,FzR=cfg.mass*G*lf/cfg.wheelBase;
  const maxLong=Math.max(cfg.engineForce*1.5,cfg.brakeForce);
  const rollN=(cfg.rollResist/1000)*cfg.mass*G;
  const state={position:{x:0,y:0,z:0},heading:0,velocity:{x:0,y:0,z:0},forwardSpeed:0,lateralSpeed:0,slipAngle:0,steerAngle:0,throttle:0,brake:0,nitroActive:false,nitroAmount:cfg.nitroCapacity,gear:1,rpm:900,lap:1,checkpointIndex:0,racePosition:1,distanceAlong:0,offTrack:false,crashed:false,crashIntensity:0,finished:false,finishTime:0};
  let yawRate=0,prevS=0,armed=false;

  // ---- one fixed physics step ----
  function step(dt,input){
    if(!(dt>0))dt=1/120;
    input=input||{};
    const steerIn=clamp(num(input.steer,0),-1,1);
    const thr=clamp(num(input.throttle,0),0,1);
    const brk=clamp(num(input.brake,0),0,1);
    state.throttle=thr;state.brake=brk;
    const v0=state.forwardSpeed;

    // steering: rate-limited toward speed-scaled target
    const maxEff=cfg.maxSteerAngle/(1+Math.pow(Math.abs(v0)/55,2)*2.2);
    const dmax=cfg.steerSpeed*dt;
    state.steerAngle+=clamp(steerIn*maxEff-state.steerAngle,-dmax,dmax);

    // gear + rpm
    const sp=Math.abs(v0);
    let gear=1;
    for(let i=1;i<6;i++)if(sp>=cfg.speedsPerGear[i])gear=i+1;
    state.gear=gear;
    const lo=cfg.speedsPerGear[gear-1],hi=cfg.speedsPerGear[Math.min(gear,6)];
    state.rpm=900+clamp((sp-lo)/Math.max(hi-lo,1),0,1)*5200;
    const gm=(cfg.finalDrive/3.4)*(1.5-0.18*(gear-1));

    // nitro tank
    const na=!!input.nitro&&state.nitroAmount>0.05&&v0>5;
    state.nitroActive=na;
    if(na)state.nitroAmount=clamp(state.nitroAmount-0.35*dt,0,cfg.nitroCapacity);
    else if(thr>0.5)state.nitroAmount=clamp(state.nitroAmount+0.06*dt,0,cfg.nitroCapacity);

    // longitudinal forces
    let longF=thr*cfg.engineForce*gm+(na?cfg.nitroForce:0);
    longF-=cfg.dragCoeff*v0*Math.abs(v0);
    const sv=v0>0.05?1:(v0<-0.05?-1:0);
    longF-=sv*rollN;
    if(state.offTrack)longF-=cfg.offTrackDrag*v0;
    const brakeF=brk*cfg.brakeForce;
    longF-=sv*brakeF;
    const ellipse=1-Math.pow(Math.min(1,Math.abs(longF)/maxLong),2)*0.55;

    // Pacejka-lite lateral tires (bicycle)
    const vx=Math.abs(v0)<0.5?(v0<0?-0.5:0.5):v0;
    const aF=state.steerAngle-Math.atan2(state.lateralSpeed+yawRate*lf,vx);
    const aR=-Math.atan2(state.lateralSpeed-yawRate*lr,vx);
    const FyF=lg.D*Math.sin(lg.C*Math.atan(lg.B*aF))*FzF*ellipse;
    const FyR=lg.D*Math.sin(lg.C*Math.atan(lg.B*aR))*FzR*ellipse;

    // yaw -> heading (single yaw authority)
    const yawAcc=(FyR*lr-FyF*Math.cos(state.steerAngle)*lf)/cfg.Iz;
    yawRate=clamp(yawRate+yawAcc*dt,-3.5,3.5);
    state.heading+=yawRate*dt;

    // integrate body-frame speeds
    let nv=v0+longF/cfg.mass*dt;
    if(sv!==0&&brk>0&&(sv>0?nv<0:nv>0))nv=0;
    state.forwardSpeed=clamp(nv,-15,95);
    state.lateralSpeed=clamp((state.lateralSpeed+(FyF+FyR)/cfg.mass*dt)*(1-0.6*dt),-30,30);
    state.slipAngle=Math.atan2(state.lateralSpeed,Math.max(Math.abs(state.forwardSpeed),0.5));

    // compose velocity from basis, integrate position
    const b=basisFromHeading(state.heading);
    state.velocity.x=b.forward.x*state.forwardSpeed+b.right.x*state.lateralSpeed;
    state.velocity.z=b.forward.z*state.forwardSpeed+b.right.z*state.lateralSpeed;
    state.velocity.y=0;
    state.position.x+=state.velocity.x*dt;
    state.position.z+=state.velocity.z*dt;

    // ---- track query: guardrails, off-track, laps ----
    let hit=false;
    if(trackQuery&&typeof trackQuery.project==='function'){
      const q=trackQuery.project(state.position);
      if(q&&isFinite(q.s)&&isFinite(q.lateral)){
        const halfW=num(trackQuery.halfWidthAt?trackQuery.halfWidthAt(q.s):6,6);
        const limit=Math.max(halfW-cfg.carHalfWidth,0.4);
        const lat=q.lateral;
        if(Math.abs(lat)>limit){
          const t=q.tangent||{x:0,z:-1};
          let nx=-t.z,nz=t.x;
          const q2=trackQuery.project({x:state.position.x+nx*0.05,y:state.position.y,z:state.position.z+nz*0.05});
          if(q2&&isFinite(q2.lateral)&&Math.abs(q2.lateral)>Math.abs(lat)){nx=-nx;nz=-nz;}
          const push=Math.abs(lat)-limit;
          state.position.x+=nx*push;state.position.z+=nz*push;
          const vn=state.velocity.x*nx+state.velocity.z*nz;
          if(vn<0){
            state.velocity.x-=nx*vn;state.velocity.z-=nz*vn;
            const impact=-vn;
            hit=true;
            state.crashed=true;
            state.crashIntensity=clamp(impact/25,0,1);
            const f=1-clamp(0.25*impact,0,0.8);
            state.velocity.x*=f;state.velocity.z*=f;
          }
          state.forwardSpeed=clamp(state.velocity.x*b.forward.x+state.velocity.z*b.forward.z,-15,95);
          state.lateralSpeed=clamp(state.velocity.x*b.right.x+state.velocity.z*b.right.z,-30,30);
        }
        state.offTrack=Math.abs(q.lateral)>halfW*0.94;
        const L=num(trackQuery.length,1)||1;
        const s=q.s;
        if(armed){
          if(prevS>L*0.75&&s<L*0.25)state.lap++;
          else if(prevS<L*0.25&&s>L*0.75&&state.lap>1)state.lap--;
        }
        prevS=s;armed=true;
        state.distanceAlong=s;
        const cps=trackQuery.checkpoints;
        if(cps&&cps.length){
          const ci=state.checkpointIndex%cps.length;
          let diff=s-cps[ci];
          if(diff<-L*0.5)diff+=L;
          if(diff>=0&&diff<L*0.5)state.checkpointIndex=(ci+1)%cps.length;
        }
      }
    }
    if(!hit)state.crashIntensity=Math.max(0,state.crashIntensity*(1-3*dt));
    if(state.crashIntensity<=0.001)state.crashed=false;
    if(state.lap>3){state.finished=true;state.finishTime+=dt;}

    if(trackQuery&&typeof trackQuery.groundHeightAt==='function'){
      const y=trackQuery.groundHeightAt(state.position.x,state.position.z);
      if(typeof y==='number'&&isFinite(y))state.position.y=y;
    }

    // numerical safety
    if(!isFinite(state.heading))state.heading=0;
    if(!isFinite(yawRate))yawRate=0;
    if(!isFinite(state.forwardSpeed))state.forwardSpeed=0;
    if(!isFinite(state.lateralSpeed))state.lateralSpeed=0;
    if(!isFinite(state.velocity.x))state.velocity.x=0;
    if(!isFinite(state.velocity.z))state.velocity.z=0;
    if(!isFinite(state.position.x))state.position.x=0;
    if(!isFinite(state.position.z))state.position.z=0;
    if(!isFinite(state.position.y))state.position.y=0;
    return state;
  }

  // ---- reset ----
  function reset(pose){
    pose=pose||{};
    const p=pose.position||{};
    state.position.x=num(p.x,0);state.position.y=num(p.y,0);state.position.z=num(p.z,0);
    state.heading=num(pose.heading,0);
    state.velocity.x=0;state.velocity.y=0;state.velocity.z=0;
    state.forwardSpeed=0;state.lateralSpeed=0;state.slipAngle=0;state.steerAngle=0;
    state.throttle=0;state.brake=0;state.nitroActive=false;state.nitroAmount=cfg.nitroCapacity;
    state.gear=1;state.rpm=900;state.lap=1;state.checkpointIndex=0;state.racePosition=1;
    state.distanceAlong=num(pose.s,0);state.offTrack=false;state.crashed=false;
    state.crashIntensity=0;state.finished=false;state.finishTime=0;
    yawRate=0;prevS=state.distanceAlong;armed=true;
    return state;
  }

  return {state,step,reset};
}