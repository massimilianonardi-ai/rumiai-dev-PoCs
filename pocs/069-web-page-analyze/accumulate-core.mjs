// Deterministic accumulating transcript index. Its input is actual DOM
// mount/unmount observations, not scrollTop, screenshots or page snapshots.
// HTML remains verbatim captured payload (sanitized by the source observer).
export class Accumulator {
  constructor(){
    this.nodes=new Map();
    this.edges=new Map();
    this.frames=0;this.events=0;this.updates=0;this.remounts=0;
    this.conflicts=new Set();this.unstable=new Set();
    this.firstFrame=null;this.lastFrame=null;
    this.htmlClass='';this.bodyClass='';
  }
  ingest(packet){
    this.events++;
    if(packet.kind==='frame'){
      const keys=[...new Set((packet.keys||[]).filter(x=>typeof x==='string'))];
      if(this.firstFrame===null&&keys.length)this.firstFrame=keys;
      if(keys.length)this.lastFrame=keys;
      this.frames++;
      this.htmlClass=packet.htmlClass||this.htmlClass;
      this.bodyClass=packet.bodyClass||this.bodyClass;
      for(let i=1;i<keys.length;i++){
        const from=keys[i-1],to=keys[i];
        if(from===to)continue;
        if(!this.edges.has(from))this.edges.set(from,new Set());
        this.edges.get(from).add(to);
      }
      return;
    }
    if(!['added','removed','updated'].includes(packet.kind)||
       typeof packet.key!=='string'||!packet.key||
       typeof packet.html!=='string')return;
    if(!packet.stable)this.unstable.add(packet.key);
    const before=this.nodes.get(packet.key);
    if(before){
      if(packet.kind==='added'&&before.removed)this.remounts++;
      if(before.hash!==packet.hash){this.updates++;}
    }
    const entry={key:packet.key,html:packet.html,hash:packet.hash,
      role:packet.role||before?.role||null,stable:packet.stable===true,
      ancestors:packet.ancestors?.length?packet.ancestors:before?.ancestors||[],
      firstSeen:before?.firstSeen??this.nodes.size,
      revisions:(before?.revisions||0)+(before?.hash!==packet.hash?1:0),
      removed:packet.kind==='removed'};
    // Prefer the latest nonempty snapshot of the node; the final node may
    // be detached during removal but content still exists in its outerHTML.
    if(before&&entry.html.length<before.html.length*.20&&packet.kind==='removed'){
      entry.html=before.html;entry.hash=before.hash;
    }
    this.nodes.set(packet.key,entry);
  }
  order(){
    const nodes=[...this.nodes.values()].sort((a,b)=>a.firstSeen-b.firstSeen);
    const degrees=new Map(nodes.map(x=>[x.key,0]));
    const undirected=new Map(nodes.map(x=>[x.key,new Set()]));
    let edges=0;
    for(const [a,neighbors] of this.edges){
      for(const b of neighbors){
        if(!degrees.has(a)||!degrees.has(b))continue;
        degrees.set(b,degrees.get(b)+1);edges++;
        undirected.get(a).add(b);undirected.get(b).add(a);
      }
    }
    const byKey=this.nodes;
    const ready=[...degrees].filter(x=>x[1]===0).map(x=>x[0])
      .sort((a,b)=>byKey.get(a).firstSeen-byKey.get(b).firstSeen);
    const result=[];
    while(ready.length){
      const id=ready.shift();result.push(id);
      for(const next of this.edges.get(id)||[]){
        if(!degrees.has(next))continue;
        degrees.set(next,degrees.get(next)-1);
        if(degrees.get(next)===0){
          ready.push(next);
          ready.sort((a,b)=>byKey.get(a).firstSeen-byKey.get(b).firstSeen);
        }
      }
    }
    const cycle=result.length<nodes.length;
    if(cycle){
      for(const item of nodes)
        if(!result.includes(item.key))result.push(item.key);
    }
    const visited=new Set();
    let components=0;
    for(const item of nodes){
      if(visited.has(item.key))continue;
      components++;
      const queue=[item.key];visited.add(item.key);
      while(queue.length){
        for(const next of undirected.get(queue.shift())){
          if(!visited.has(next)){visited.add(next);queue.push(next);}
        }
      }
    }
    return {keys:result,components,cycle,edges};
  }
  report(){
    const order=this.order();
    return {distinct:this.nodes.size,frames:this.frames,events:this.events,
      updates:this.updates,remounts:this.remounts,
      unstableIdentities:this.unstable.size,
      orderComponents:order.components,orderCycle:order.cycle,
      orderingEdges:order.edges,keys:order.keys,
      firstFrame:this.firstFrame,lastFrame:this.lastFrame,
      completeExportVerified:false,
      notes:['The original virtualizer may omit segments during traversal.',
        'Disconnected ordering components, cycles and unstable IDs are incomplete evidence.',
        'No absolute chronological count/first/last boundary is yet certified.',
        'Rich attached files and CSS require independent byte/visual audits.']};
  }
  serializable(){
    return {report:this.report(),records:[...this.nodes.values()]};
  }
}
