// PoC external bridge: consumes the minimal history change notification.
// The editor never imports this module. Storage is any async adapter with
// count/read/appendAt/readSession/writeSession (file/IndexedDB/service).
// Attach to an EMPTY history and EMPTY backend; data recovery is separate.
export class BackgroundPersistence {
  constructor(history,storage) {
    for(const key of ['count','appendAt','readSession','writeSession'])
      if(typeof storage?.[key]!=='function')throw new TypeError('storage: '+key);
    if(history.length!==0||history.index!==0)throw new Error('attach before first edit');
    this.history=history;
    this.storage=storage;
    this.queue=[];
    this.head=0;
    this.issued=0;
    this.completed=0;
    this.running=false;
    this.error=null;
    this.waiters=[];
    this.disabled=false;
    this.unsubscribe=history.subscribe(change=>this.enqueue(change));
    // First event initializes a new optional persistent history.
    this.enqueue({kind:'initialize',initial:{primary:history.initial.primary,ranges:history.initial.ranges.map(r=>({...r}))},cursor:0});
  }
  get pending(){return this.issued-this.completed;}
  get status(){return {pending:this.pending,error:this.error};}
  enqueue(event){
    if(this.disabled)return;
    this.queue.push({serial:++this.issued,event});
    if(!this.running&&!this.error){this.running=true;queueMicrotask(()=>this.drain());}
  }
  settleWaiters(){
    const remaining=[];
    for(const w of this.waiters){
      if(this.error)w.reject(this.error);
      else if(this.completed>=w.target)w.resolve();
      else remaining.push(w);
    }
    this.waiters=remaining;
  }
  async drain(){
    while(!this.error&&this.head<this.queue.length){
      const {serial,event}=this.queue[this.head];
      try {
        if(event.kind==='initialize'){
          if(await this.storage.count()!==0||await this.storage.readSession()!==null)
            throw new Error('storage already contains a session');
          await this.storage.writeSession({initial:event.initial,cursor:0});
        }else if(event.kind==='append'){
          await this.storage.appendAt(event.at,event.record);
          await this.storage.writeSession({initial:this.history.initial,cursor:event.cursor});
        }else if(event.kind==='cursor'){
          await this.storage.writeSession({initial:this.history.initial,cursor:event.cursor});
        }else throw new Error('unknown history change');
      } catch(error){this.error=error;break;}
      this.completed=serial;
      this.head++;
      // Trim consumed records in batches to avoid quadratic queue shifts.
      if(this.head>256 && this.head*2>=this.queue.length){
        this.queue=this.queue.slice(this.head);this.head=0;
      }
      this.settleWaiters();
    }
    this.running=false;
    this.settleWaiters();
  }
  // EXPLICIT external call: wait only for changes present at invocation time.
  flush(){
    if(this.error)return Promise.reject(this.error);
    const target=this.issued;
    if(this.completed>=target)return Promise.resolve();
    return new Promise((resolve,reject)=>this.waiters.push({target,resolve,reject}));
  }
  detach(){this.disabled=true;this.unsubscribe();}
}
