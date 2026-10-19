window.ReactQueryError ??= class ReactQueryError extends Error {};
null==Promise.withResolvers&&(Promise.withResolvers=function(){let e,r;return{promise:new Promise((s,o)=>{e=s,r=o}),resolve:e,reject:r}});
window.__REACT_QUERY_CACHE__ ??= {}