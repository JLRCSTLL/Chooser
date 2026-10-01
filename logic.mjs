export function uniformIndex(count,random=buffer=>crypto.getRandomValues(buffer)){
  if(!Number.isInteger(count)||count<1||count>4294967296)throw new RangeError('Invalid participant count');
  const ceiling=Math.floor(4294967296/count)*count,buffer=new Uint32Array(1);
  do{random(buffer);}while(buffer[0]>=ceiling);return buffer[0]%count;
}
// IDs track nearby face positions only. They are never biometric identities.
export class FaceTracker {
  constructor(){this.tracks=[];this.nextId=1;}
  reset(){this.tracks=[];this.nextId=1;}
  update(boxes,now){
    const old=this.tracks.filter(t=>now-t.lastSeen<700);
    const candidates=[];
    for(let i=0;i<old.length;i++)for(let j=0;j<boxes.length;j++){
      const t=old[i],b=boxes[j],dt=Math.min(250,now-t.lastSeen);if(t.uncertain)continue;
      const dx=(b.x+b.width/2)-(t.x+t.width/2+t.vx*dt),dy=(b.y+b.height/2)-(t.y+t.height/2+t.vy*dt);
      const distance=Math.hypot(dx,dy),scale=Math.abs(Math.log(b.width/t.width));
      if(distance<Math.min(.18,Math.max(.06,t.width*.8))&&scale<.65)candidates.push({i,j,cost:distance+scale*.025});
    }
    candidates.sort((a,b)=>a.cost-b.cost);const usedTracks=new Set(),usedBoxes=new Set(),uncertainIds=new Set(),next=[];
    for(const c of candidates)for(const other of candidates){if(other!==c&&(other.i===c.i||other.j===c.j)&&Math.abs(other.cost-c.cost)<.018){uncertainIds.add(c.i);uncertainIds.add(other.i);}}
    for(const c of candidates){
      if(usedTracks.has(c.i)||usedBoxes.has(c.j)||uncertainIds.has(c.i))continue;
      const t=old[c.i],b=boxes[c.j],dt=Math.max(1,now-t.lastSeen);
      next.push({...b,id:t.id,hits:t.hits+1,lastSeen:now,visible:true,vx:(b.x-t.x)/dt,vy:(b.y-t.y)/dt});usedTracks.add(c.i);usedBoxes.add(c.j);
    }
    old.forEach((t,i)=>{if(!usedTracks.has(i))next.push({...t,visible:false,hits:0,uncertain:t.uncertain||uncertainIds.has(i)});});
    boxes.forEach((b,j)=>{if(!usedBoxes.has(j))next.push({...b,id:this.nextId++,hits:1,lastSeen:now,visible:true,vx:0,vy:0});});
    this.tracks=next;return next;
  }
}
export function containRect(containerWidth,containerHeight,imageWidth,imageHeight){const scale=Math.min(containerWidth/imageWidth,containerHeight/imageHeight),width=imageWidth*scale,height=imageHeight*scale;return {x:(containerWidth-width)/2,y:(containerHeight-height)/2,width,height};}
export function normalizedBoxes(detections,width,height,mirrored=false){return detections.filter(d=>d.boundingBox).map(d=>{const b=d.boundingBox,pad=b.width*.12;let left=Math.max(0,b.originX-pad),right=Math.min(width,b.originX+b.width+pad);const top=Math.max(0,b.originY-pad),bottom=Math.min(height,b.originY+b.height+pad);if(mirrored){const old=left;left=width-right;right=width-old;}return {x:left/width,y:top/height,width:(right-left)/width,height:(bottom-top)/height};}).filter(b=>b.width>0&&b.height>0).sort((a,b)=>a.x-b.x||a.y-b.y);}
