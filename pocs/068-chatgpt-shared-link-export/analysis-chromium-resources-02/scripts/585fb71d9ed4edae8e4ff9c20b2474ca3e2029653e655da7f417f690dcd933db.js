const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/7aa2b76f-jkj9ryhr2nwb0g78.js","assets/f025431a-ehagpvg3m4e1cduv.js","assets/4813494d-mflwonje5cjvc1ql.js","assets/2340486e-oc6d2eodbcrmxur3.js","assets/root-lelxp0l2.css","assets/conversation-small-fcu1fuggk1duh76x.js","assets/30901919-djrjui6l5gbrne37.js","assets/c470f5ab-olxn4jy9xumgkrqi.js","assets/0e5afe53-k0mlljqitc7l7i7t.js","assets/conversation-small-l5wzap56.css","assets/8b34dbc2-i6mnaw2f0obqfl0x.js","assets/82782bc9-b1zsa6mllcky40z0.js"])))=>i.map(i=>d[i]);
import{n as e,r as t,s as n}from"./f025431a-ehagpvg3m4e1cduv.js";import{$c as r,A5 as i,Az as a,Bnt as o,G5 as s,Gnt as c,IN as l,J0 as u,JT as d,K5 as f,Knt as p,LN as m,Qnt as h,SN as g,Vp as _,Wp as v,Xy as y,Y0 as b,Yy as ee,_N as x,art as S,b2 as C,bU as w,cl as te,dY as ne,ert as T,fF as E,jz as D,k5 as re,mF as ie,nY as O,ort as k,qT as A,srt as j,uF as M,vN as N,y2 as ae,yN as oe,yU as se}from"./4813494d-mflwonje5cjvc1ql.js";import{Bn as ce,Ln as P,Nn as F,Rn as le,Vn as I,cn as ue,ln as L,wn as de,zn as fe}from"./2340486e-oc6d2eodbcrmxur3.js";import{A6 as pe,Dhn as me,E6 as he,JNt as ge,NUn as R,PUn as _e,T6 as ve,YNt as z,_6 as ye,_C as be,b6 as xe,cVn as B,cr as V,gC as H,iA as U,j6 as Se,k6 as Ce,khn as we,lVn as Te,ld as Ee,nT as De,qNt as Oe,rT as ke,sr as Ae,tA as je,ud as Me,v6 as Ne,w6 as W,x6 as Pe,y6 as Fe}from"./conversation-small-fcu1fuggk1duh76x.js";import{bS as Ie,n_ as Le,nb as Re,r_ as ze,rb as G,yS as Be}from"./30901919-djrjui6l5gbrne37.js";import{n as Ve,r as He}from"./2ea88c7a-lxyla91xs6iv7odf.js";import{a as Ue,o as We,r as Ge,t as Ke}from"./8d846022-bvik3sltoydb2o43.js";import{i as qe,n as Je,r as Ye}from"./91969468-gl28wa5aorjt8dhx.js";import{n as K,t as Xe}from"./4d271a7b-gzufn5wwf0ilfejh.js";import{n as Ze,r as Qe}from"./58bafdef-j5q88ep13rtpnqg8.js";import{a as $e,i as et}from"./e01e2324-kbwb77s1o2kwe9yn.js";import{i as tt,t as nt}from"./5dc32f04-dvh5mpuknebjqtoh.js";import{c as rt,i as it,o as at,r as ot,s as st,t as ct}from"./56dee4d8-i39wkq0c43brbpbb.js";import{n as lt,t as ut}from"./72bb039a-iheh04wb74j962wn.js";import{i as dt,n as ft,r as pt,t as mt}from"./9eb56efa-ounshovfwjcu9ca3.js";import{i as ht,n as gt,r as q,t as _t}from"./cc79834b-b2wiwue1k18obttw.js";function vt(){return o(`2779568043`)}function J(){return o(`3864712762`)}function yt(){return c(`522383056`,{disableExposureLog:!0}).get(`app_block_library_editing`,!1)}var bt=e((()=>{p()}));function xt({loadSource:e,errorSource:t,errorType:n,networkPolicy:r,outcome:i,readySignal:a,renderMode:o,surface:s,variant:c}){let l={network_policy:r,surface:s};return e!=null&&(l.load_source=e),t!=null&&(l.error_source=t),n!=null&&(l.error_type=n),i!=null&&(l.outcome=i),a!=null&&(l.ready_signal=a),o!=null&&(l.render_mode=o),c!=null&&(l.variant=c),l}function St(){return typeof performance<`u`?performance.now():Date.now()}function Ct(e){return new TextEncoder().encode(e).byteLength/1024}function wt(e){return e instanceof Error?e.name:`unknown`}function Tt(e,t,n=1){k.count(j.APP_BLOCKS,e,xt(t),n)}function Et(e,t,n){k.hist(j.APP_BLOCKS,e,xt(n),t)}function Dt({content:e,metricTags:t,widgetRefSeenAtMs:n}){let r=(0,Ot.useRef)(St()),i=(0,Ot.useRef)(null),a=(0,Ot.useRef)(!1),o=(0,Ot.useRef)(!1),s=N(()=>{i.current==null||typeof window>`u`||(window.cancelAnimationFrame(i.current),i.current=null)}),c=N((n=e)=>{o.current||(o.current=!0,Et(jt,Ct(n),t))});return{cancelFirstPaintFrame:s,startRunMetrics:N((e,{deferFirstPaint:o=!1,deferPayloadSize:l=!1}={})=>{let u=St(),d=!1,f=!1,p=!1,m=!1,h=null,g=null;s(),l||c(),Tt(Pt,t);let _=(e,n)=>{f||(f=!0,Tt(Nt,{...t,outcome:e,readySignal:n}))},v=(i,o)=>{if(!e()||p)return;let s=St();Et(Mt,s-i,{...t,readySignal:o}),!a.current&&(a.current=!0,Et(kt,s-r.current,t),n!=null&&Et(It,s-n,t))},y=(e,n)=>{if(s(),typeof window>`u`){v(e,n);return}i.current=window.requestAnimationFrame(()=>{if(t.loadSource===`saved_inline`){i.current=window.requestAnimationFrame(()=>{i.current=null,v(e,n)});return}i.current=null,v(e,n)})},b=()=>{!e()||p||m||h==null||g==null||(m=!0,y(h,g))};return{markFirstPaint:b,markReady:n=>{!e()||d||(d=!0,h=St(),g=n,Et(Ft,h-u,{...t,readySignal:n}),o||b())},reportFailure:(n,r)=>{!e()||p||(p=!0,s(),Tt(At,{...t,errorSource:n,errorType:r}),_(`failure`))},reportPayloadSize:t=>{!e()||p||c(t)},reportSuccess:t=>{e()&&_(`success`,t)}}})}}var Ot,kt,At,jt,Mt,Nt,Pt,Ft,It,Lt=e((()=>{S(),x(),Ot=n(I()),kt=`app_block.first_render_time_ms`,At=`app_block.load.failure`,jt=`app_block.payload_size_kb`,Mt=`app_block.ready_to_first_paint_ms`,Nt=`app_block.render.outcome`,Pt=`app_block.render.start`,Ft=`app_block.sandbox_eval_to_ready_ms`,It=`app_block.widget_ref_to_first_paint_ms`})),Rt,zt=e((()=>{Rt=`:root{--lightningcss-light:initial;--lightningcss-dark: ;--lightningcss-light:initial;--lightningcss-dark: ;color-scheme:light dark;--app-block-paint-gutter-block:0px;--app-block-paint-gutter-inline:0px}@media (prefers-color-scheme:dark){:root{--lightningcss-light: ;--lightningcss-dark:initial}}:root.light{--lightningcss-light:initial;--lightningcss-dark: ;--lightningcss-light:initial;--lightningcss-dark: ;color-scheme:light}:root.dark{--lightningcss-light: ;--lightningcss-dark:initial;--lightningcss-light: ;--lightningcss-dark:initial;color-scheme:dark}:root[data-app-block-surface=inline]{--app-block-paint-gutter-block:4px;--app-block-paint-gutter-inline:4px}:root[data-app-block-surface=skybridge]{--app-block-paint-gutter-block:16px;--app-block-paint-gutter-inline:16px}:root[data-app-block-surface=skybridge]:is([data-app-block-platform=ios],[data-app-block-platform=android]){--app-block-paint-gutter-block:0px;--app-block-paint-gutter-inline:0px}html,body{background:0 0;overflow:hidden}:root[data-app-block-surface=stage]{overscroll-behavior:contain;overflow:auto}:root[data-app-block-surface=stage] body{overflow:visible}body{margin:0;padding:0}main{box-sizing:border-box;width:100%;min-width:0;padding-block:var(--app-block-paint-gutter-block);padding-inline:var(--app-block-paint-gutter-inline);display:flow-root}:root[data-app-block-surface=skybridge]:is([data-app-block-platform=ios],[data-app-block-platform=android]) main>:has(>:first-child:is(style,script))>:nth-child(1 of :not(style,script)){margin-block-start:0}:root[data-app-block-surface=skybridge] main{overscroll-behavior-x:contain;overflow-x:auto}:where(svg){max-width:100%;height:auto}`})),Bt=e((()=>{})),Vt,Ht=e((()=>{Bt(),Vt=`/cdn/assets/app-block-sandbox-foundation-l4fcvweu.css`})),Ut,Wt=e((()=>{Ut=`:root{--lightningcss-light:initial;--lightningcss-dark: ;--lightningcss-light:initial;--lightningcss-dark: ;color-scheme:light dark;--white:#fff;--black:#000;--gray-0:#fff;--gray-25:#fcfcfc;--gray-50:#f9f9f9;--gray-75:#f2f2f2;--gray-100:#ececec;--gray-200:#e3e3e3;--gray-750:#2f2f2f;--gray-800:#212121;--gray-950:#0d0d0d;--app-block-paint-gutter-block:0px;--app-block-paint-gutter-inline:0px;--app-block-accent-blue:var(--lightningcss-light,#3a83f7)var(--lightningcss-dark,#2c67c5);--app-block-accent-green:var(--lightningcss-light,#53b559)var(--lightningcss-dark,#48a04c);--app-block-accent-yellow:var(--lightningcss-light,#f6c543)var(--lightningcss-dark,#d9a337);--app-block-accent-purple:var(--lightningcss-light,#8952ee)var(--lightningcss-dark,#7849d1);--app-block-accent-pink:var(--lightningcss-light,#e0766d)var(--lightningcss-dark,#c96257);--app-block-accent-orange:var(--lightningcss-light,#ee7c37)var(--lightningcss-dark,#d25e28);--app-block-accent:var(--app-block-accent-blue);--app-block-accent-text:var(--white);--app-block-accent-bg:color-mix(in srgb, var(--app-block-accent) 8%, transparent);--app-block-accent-bg-subtle:color-mix(in srgb, var(--app-block-accent) 5%, transparent);--app-block-form-control-bg:color-mix(in srgb, var(--viz-text) 2%, var(--main-surface-primary));--app-block-form-control-border:color-mix(in srgb, var(--viz-text) 32%, transparent);--app-block-form-control-shadow:0 1px 2px -1px #00000014;--app-block-form-switch-off-bg:color-mix(in srgb, var(--viz-text) 14%, transparent);--app-block-form-switch-thumb-bg:var(--white);--app-block-form-switch-thumb-border:#0000001a;--app-block-select-picker-bg:var(--main-surface-primary);--app-block-select-picker-check-icon:url(data:image/svg+xml,%3Csvg%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2016%2016%22%20fill%3D%22black%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cpath%20d%3D%22M12.0961%202.91371C12.3297%202.68688%2012.6984%202.64794%2012.9779%202.83852C13.2571%203.02905%2013.3554%203.38601%2013.2299%203.68618L13.1615%203.81118L6.91152%2012.9772C6.79412%2013.1494%206.60631%2013.2604%206.39882%2013.2799C6.19137%2013.2994%205.98565%2013.226%205.83828%2013.0788L2.08828%209.32875L1.99843%209.2184C1.81921%208.94677%201.84928%208.57767%202.08828%208.33852C2.3274%208.0994%202.69648%208.06947%202.96816%208.24868L3.07851%208.33852L6.23085%2011.4909L12.0053%203.02211L12.0961%202.91371Z%22/%3E%3C/svg%3E);--app-block-select-picker-hover-bg:#0000000a;--app-block-select-picker-icon:url(data:image/svg+xml,%3Csvg%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2016%2016%22%20fill%3D%22black%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cpath%20d%3D%22M12.1338%205.94433C12.3919%205.77382%2012.7434%205.80202%2012.9707%206.02929C13.1979%206.25656%2013.2261%206.60807%2013.0556%206.8662L12.9707%206.9707L8.47067%2011.4707C8.21097%2011.7304%207.78896%2011.7304%207.52926%2011.4707L3.02926%206.9707L2.9443%206.8662C2.77379%206.60807%202.80199%206.25656%203.02926%206.02929C3.25653%205.80202%203.60804%205.77382%203.86617%205.94433L3.97067%206.02929L7.99996%2010.0586L12.0293%206.02929L12.1338%205.94433Z%22/%3E%3C/svg%3E);--app-block-select-picker-shadow:0 8px 24px #00000014, 0 2px 8px #00000014;--viz-panel:var(--main-surface-secondary);--viz-card:var(--main-surface-primary);--viz-chip-card:var(--gray-75);--viz-border:var(--border-light);--viz-text:var(--text-primary);--viz-muted:var(--text-secondary);--viz-accent:var(--app-block-accent);--viz-accent-text:var(--app-block-accent-text);--viz-accent-bg:var(--app-block-accent-bg);--viz-accent-bg-subtle:var(--app-block-accent-bg-subtle);--viz-series-1:var(--app-block-accent);--viz-series-2:var(--app-block-accent-green);--viz-series-3:var(--app-block-accent-orange);--viz-series-4:var(--app-block-accent-yellow);--viz-series-5:var(--app-block-accent-purple);--viz-series-6:var(--app-block-accent-pink);--color-background-primary:var(--main-surface-primary);--color-background-secondary:var(--main-surface-secondary);--color-border-secondary:var(--border-light);--color-text-primary:var(--text-primary);--color-text-secondary:var(--text-secondary);--color-text-tertiary:var(--text-tertiary);--color-text-inverse:var(--text-primary-inverse)}@media (prefers-color-scheme:dark){:root{--lightningcss-light: ;--lightningcss-dark:initial}}:root,:root.light{--main-surface-primary:var(--gray-25);--main-surface-secondary:var(--gray-50);--main-surface-tertiary:var(--gray-100);--text-primary:var(--gray-950);--text-secondary:#0009;--text-tertiary:#0000004a;--text-primary-inverse:var(--gray-0);--text-secondary-inverse:#ffffffb3;--text-tertiary-inverse:#ffffff94;--surface-primary-inverse:var(--gray-950);--border-light:#0000001a;--border-medium:#00000026;--interactive-bg-primary-default:var(--gray-950);--interactive-label-primary-default:var(--gray-0);--interactive-border-focus:var(--gray-950);--link:#2964aa}:root.light{--lightningcss-light:initial;--lightningcss-dark: ;--lightningcss-light:initial;--lightningcss-dark: ;color-scheme:light}@media (prefers-color-scheme:dark){:root:not(.light){--lightningcss-light: ;--lightningcss-dark:initial;--lightningcss-light: ;--lightningcss-dark:initial;color-scheme:dark;--main-surface-primary:var(--black);--main-surface-secondary:var(--gray-800);--main-surface-tertiary:var(--gray-750);--app-block-select-picker-bg:var(--main-surface-secondary);--app-block-select-picker-hover-bg:#ffffff1a;--app-block-select-picker-shadow:0 12px 32px #00000061, 0 2px 8px #00000052;--viz-card:var(--main-surface-secondary);--viz-chip-card:var(--main-surface-tertiary);--viz-panel:var(--main-surface-secondary);--text-primary:var(--gray-100);--text-secondary:#ffffffb3;--text-tertiary:#ffffff94;--text-primary-inverse:var(--gray-950);--text-secondary-inverse:#0009;--text-tertiary-inverse:#0000004a;--surface-primary-inverse:var(--gray-100);--border-light:#ffffff1a;--border-medium:#ffffff26;--interactive-bg-primary-default:var(--gray-100);--interactive-label-primary-default:var(--gray-950);--interactive-border-focus:var(--gray-100);--link:#7ab7ff}}:root.dark{--lightningcss-light: ;--lightningcss-dark:initial;--lightningcss-light: ;--lightningcss-dark:initial;color-scheme:dark;--main-surface-primary:var(--black);--main-surface-secondary:var(--gray-800);--main-surface-tertiary:var(--gray-750);--app-block-select-picker-bg:var(--main-surface-secondary);--app-block-select-picker-hover-bg:#ffffff1a;--app-block-select-picker-shadow:0 12px 32px #00000061, 0 2px 8px #00000052;--viz-card:var(--main-surface-secondary);--viz-chip-card:var(--main-surface-tertiary);--viz-panel:var(--main-surface-secondary);--text-primary:var(--gray-100);--text-secondary:#ffffffb3;--text-tertiary:#ffffff94;--text-primary-inverse:var(--gray-950);--text-secondary-inverse:#0009;--text-tertiary-inverse:#0000004a;--surface-primary-inverse:var(--gray-100);--border-light:#ffffff1a;--border-medium:#ffffff26;--interactive-bg-primary-default:var(--gray-100);--interactive-label-primary-default:var(--gray-950);--interactive-border-focus:var(--gray-100);--link:#7ab7ff}:root[data-chat-theme=default],:root[data-chat-theme=black],:root[data-chat-theme=blue]{--app-block-accent:var(--app-block-accent-blue);--app-block-accent-text:var(--white)}:root[data-chat-theme=green]{--app-block-accent:var(--app-block-accent-green);--app-block-accent-text:var(--white);--viz-series-2:var(--app-block-accent-blue)}:root[data-chat-theme=yellow]{--app-block-accent:var(--app-block-accent-yellow);--app-block-accent-text:var(--gray-950)}:root[data-chat-theme=purple]{--app-block-accent:var(--app-block-accent-purple);--app-block-accent-text:var(--white)}:root[data-chat-theme=pink]{--app-block-accent:var(--app-block-accent-pink);--app-block-accent-text:var(--white);--viz-series-6:var(--app-block-accent-blue)}:root[data-chat-theme=orange]{--app-block-accent:var(--app-block-accent-orange);--app-block-accent-text:var(--white);--viz-series-3:var(--app-block-accent-blue)}:root[data-app-block-surface=inline]{--app-block-paint-gutter-block:4px;--app-block-paint-gutter-inline:4px}:root[data-app-block-surface=skybridge]{--app-block-paint-gutter-block:16px;--app-block-paint-gutter-inline:16px}:root[data-app-block-surface=skybridge]:is([data-app-block-platform=ios],[data-app-block-platform=android]){--app-block-paint-gutter-block:0px;--app-block-paint-gutter-inline:0px}:root.light[data-app-block-surface=skybridge],:root.light[data-app-block-surface=stage]{--main-surface-primary:var(--white)}:root.dark[data-app-block-surface=skybridge],:root.dark[data-app-block-surface=stage]{--main-surface-primary:var(--gray-800);--main-surface-secondary:var(--gray-750)}html,body{background:0 0;overflow:hidden}:root[data-app-block-surface=stage]{overscroll-behavior:contain;overflow:auto}:root[data-app-block-surface=stage] body{overflow:visible}body{color:var(--text-primary);margin:0;padding:0;font-family:ui-sans-serif,-apple-system,system-ui,Segoe UI,Helvetica,Arial,sans-serif,Apple Color Emoji,Segoe UI Emoji}main{box-sizing:border-box;width:100%;min-width:0;padding-block:var(--app-block-paint-gutter-block);padding-inline:var(--app-block-paint-gutter-inline);display:flow-root}:root[data-app-block-surface=skybridge]:is([data-app-block-platform=ios],[data-app-block-platform=android]) main>:has(>:first-child:is(style,script))>:nth-child(1 of :not(style,script)){margin-block-start:0}:root[data-app-block-surface=skybridge] main{overscroll-behavior-x:contain;overflow-x:auto}:where(a){color:var(--link)}:where(h1,h2,h3,h4,h5,h6,label,strong,output){color:var(--text-primary)}:where(p,small){color:var(--text-secondary)}:where(input,select,textarea,button){font:inherit}:where(button):is(:enabled,:disabled){font-weight:500}button:is(:enabled,:disabled){-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}@media (hover:hover) and (pointer:fine){button:not(:disabled):hover{opacity:.85}}button:not(:disabled):active{opacity:.7}:where(input,select,textarea){background:var(--main-surface-primary);border:1px solid var(--border-medium);border-color:var(--border-medium);color:var(--text-primary);border-radius:12px}:where(){color:var(--text-tertiary)}:where(input:not([type=checkbox]):not([type=radio]):not([type=range]),select,textarea):focus{border-color:var(--border-medium);box-shadow:none;outline:none}:where(input:not([type=checkbox]):not([type=radio]):not([type=range]),select,textarea):focus-visible{border-color:var(--interactive-border-focus);outline:2px solid var(--interactive-border-focus);outline-offset:2px}:where(select:not([multiple])){cursor:pointer;min-height:34px}:where(select:required:invalid){color:var(--text-tertiary)}:where(select option){color:var(--text-primary)}:where(select:disabled){cursor:not-allowed;opacity:.5}@supports (appearance:base-select){:where(select:not([multiple])),:where(select:not([multiple]))::picker(select){appearance:base-select}:where(select:not([multiple])){align-items:center;padding-inline-end:12px}:where(select:not([multiple]))::picker(select){border:1px solid var(--border-light);background:var(--app-block-select-picker-bg);box-shadow:var(--app-block-select-picker-shadow);color:var(--text-primary);border-radius:12px;margin-top:4px;padding:6px}:where(select:not([multiple]))::picker-icon{width:16px;height:16px;color:var(--text-secondary);content:"";-webkit-mask:var(--app-block-select-picker-icon) center / 16px 16px no-repeat;-webkit-mask:var(--app-block-select-picker-icon) center / 16px 16px no-repeat;-webkit-mask:var(--app-block-select-picker-icon) center / 16px 16px no-repeat;mask:var(--app-block-select-picker-icon) center / 16px 16px no-repeat;background:currentColor;flex-shrink:0;align-self:center;margin-inline-start:auto;display:block}:where(select:not([multiple])) option{min-height:32px;color:var(--text-primary);cursor:pointer;background:0 0;border-radius:8px;justify-content:space-between;align-items:center;gap:24px;padding:7px 10px;display:flex}:where(select:not([multiple])) option:checked{background:var(--app-block-select-picker-hover-bg);outline:none}:where(select:not([multiple])) option:is(:hover,:focus-visible){background:var(--app-block-select-picker-hover-bg)}:where(select:not([multiple])):has(option:is(:hover,:focus-visible)) option:checked:not(:is(:hover,:focus-visible)){background:0 0}:where(select:not([multiple])) option:disabled{color:var(--text-tertiary)}:where(select:not([multiple])) option::checkmark{content:"";width:16px;height:16px;-webkit-mask:var(--app-block-select-picker-check-icon) center / 16px 16px no-repeat;-webkit-mask:var(--app-block-select-picker-check-icon) center / 16px 16px no-repeat;-webkit-mask:var(--app-block-select-picker-check-icon) center / 16px 16px no-repeat;mask:var(--app-block-select-picker-check-icon) center / 16px 16px no-repeat;background:currentColor;flex-shrink:0;order:1;margin-inline-start:auto;display:block}}:where(.form-check){align-items:center;gap:6px;min-height:20px;display:flex}:where(.form-check-input){appearance:none;box-sizing:border-box;border:1px solid var(--app-block-form-control-border);width:14px;height:14px;color:var(--app-block-accent-text);cursor:pointer;vertical-align:-2px;background-color:#0000;flex:none;margin:0;padding:0;transition:background-color .12s,border-color .12s,box-shadow .12s;display:inline-block}:where(.form-check:not(.form-switch) .form-check-input[type=checkbox]){background-color:var(--app-block-form-control-bg);box-shadow:var(--app-block-form-control-shadow);border-radius:5px}:where(.form-check:not(.form-switch) .form-check-input:not(:disabled):not(:checked):hover){background-color:var(--main-surface-secondary)}.form-check:not(.form-switch) .form-check-input:not(:checked):not(:indeterminate){border:1px solid var(--border-medium)}:where(.form-check:not(.form-switch) .form-check-input[type=checkbox]:checked){border-color:var(--viz-accent);background-color:var(--viz-accent)}:where(.form-check:not(.form-switch) .form-check-input[type=checkbox]:checked):before{background:var(--app-block-accent-text);content:"";width:100%;height:100%;-webkit-mask:var(--app-block-select-picker-check-icon) center / 12px 12px no-repeat;-webkit-mask:var(--app-block-select-picker-check-icon) center / 12px 12px no-repeat;-webkit-mask:var(--app-block-select-picker-check-icon) center / 12px 12px no-repeat;mask:var(--app-block-select-picker-check-icon) center / 12px 12px no-repeat;display:block}:where(.form-check:not(.form-switch) .form-check-input[type=checkbox]:indeterminate){border-color:var(--viz-accent);background-color:var(--viz-accent)}:where(.form-check:not(.form-switch) .form-check-input[type=checkbox]:indeterminate):before{background:var(--app-block-accent-text);content:"";border-radius:9999px;width:8px;height:2px;margin:5px auto;display:block}:where(.form-check-input[type=radio]){background-color:var(--app-block-form-control-bg);box-shadow:var(--app-block-form-control-shadow);border-radius:9999px}:where(.form-check-input[type=radio]:checked){border:2px solid var(--viz-accent);background:radial-gradient(circle, var(--app-block-accent-text) 0 2.5px, transparent 3px), var(--viz-accent)}:where(.form-check-input:disabled){cursor:not-allowed;pointer-events:none;opacity:.5}:where(.form-check-input:disabled+.form-check-label){cursor:not-allowed;opacity:.7}:where(.form-check-label){color:var(--viz-text);cursor:pointer}:where(.form-switch .form-check-input[type=checkbox]){background:var(--app-block-form-switch-off-bg);width:32px;height:20px;box-shadow:none;border:0;border-radius:9999px;transition:background-color .2s cubic-bezier(0,0,.2,1);position:relative}:where(.form-switch .form-check-input[type=checkbox]):before{box-sizing:border-box;border:1px solid var(--app-block-form-switch-thumb-border);background:var(--app-block-form-switch-thumb-bg);width:16px;height:16px;box-shadow:var(--app-block-form-control-shadow);content:"";border-radius:9999px;transition:transform .2s cubic-bezier(0,0,.2,1);position:absolute;top:50%;left:0;transform:translate(2px,-50%)}:where(.form-switch .form-check-input[type=checkbox]:checked){background:var(--viz-accent)}:where(.form-switch .form-check-input[type=checkbox]:checked):before{transform:translate(14px,-50%)}:where(input[type=range]){appearance:none;cursor:pointer;touch-action:pan-y;-webkit-user-select:none;user-select:none;background:0 0;border:0;border-radius:9999px;width:100%;min-width:0;height:24px;margin:0;padding:0;display:block}:where(input[type=range]:disabled){cursor:not-allowed;opacity:.4}:where(input[type=range])::-webkit-slider-runnable-track{background:var(--lightningcss-light,#0000000a)var(--lightningcss-dark,#ffffff0f);border:0;border-radius:9999px;height:6px}:where(input[type=range])::-webkit-slider-thumb{appearance:none;box-sizing:border-box;background:var(--white);border:1px solid #0000001a;border-radius:9999px;width:20px;height:20px;margin-top:-7px;transition:transform .15s;box-shadow:0 1px 2px #0000001f}:where(input[type=range])::-moz-range-track{background:var(--lightningcss-light,#0000000a)var(--lightningcss-dark,#ffffff0f);border:0;border-radius:9999px;height:6px}:where(input[type=range])::-moz-range-progress{background:0 0;border-radius:9999px;height:6px}:where(input[type=range])::-moz-range-thumb{box-sizing:border-box;background:var(--white);border:1px solid #0000001a;border-radius:9999px;width:20px;height:20px;transition:transform .15s;box-shadow:0 1px 2px #0000001f}@media (hover:hover) and (pointer:fine){:where(input[type=range]:enabled:hover)::-webkit-slider-thumb{transform:scale(1.05)}:where(input[type=range]:enabled:hover)::-moz-range-thumb{transform:scale(1.05)}}:where(input[type=range]:focus-visible){outline:none}:where(input[type=range]:focus-visible)::-webkit-slider-thumb{outline:2px solid var(--interactive-border-focus);outline-offset:2px}:where(input[type=range]:focus-visible)::-moz-range-thumb{outline:2px solid var(--interactive-border-focus);outline-offset:2px}@media (forced-colors:active){:where(.form-check-input){appearance:auto;display:revert;width:revert;height:revert;margin:revert;padding:revert;border:revert;border-radius:revert;background:revert;box-shadow:revert;vertical-align:revert}:where(.form-check-input):before{content:none}}:where(svg [role=button],svg [tabindex]):focus:not(:focus-visible){outline:none}:where(button:focus-visible){outline:2px solid var(--interactive-border-focus);outline-offset:2px}:where([data-panel]){background:var(--main-surface-secondary)}:where([data-card]){background:var(--viz-card);border-color:var(--border-light)}:where([data-result=primary]){background:var(--interactive-bg-primary-default);color:var(--interactive-label-primary-default)}:where([data-result=primary] :not(a)){color:inherit}.card{overflow-wrap:break-word;border:1px solid var(--viz-border);min-width:0;color:var(--viz-text);background:var(--viz-card);border-radius:16px;padding:12px;overflow:visible}.metric-card{overflow-wrap:break-word;min-width:0;color:var(--viz-text);background:var(--viz-chip-card);border-radius:16px;padding:12px;overflow:visible}.viz-node{overflow-wrap:break-word;border:1px solid var(--viz-border);min-width:0;color:var(--viz-text);background:0 0;border-radius:12px;padding:10px 12px}.viz-stat-value{color:var(--viz-text);font-size:20px;font-weight:500;line-height:1.25}.viz-edge-label,.viz-badge{width:fit-content;color:var(--viz-text);background:var(--viz-accent-bg);border-radius:9999px;align-items:center;padding:3px 8px;font-size:12px;font-weight:500;line-height:1.4;display:inline-flex}.viz-callout{border-left:3px solid var(--viz-accent);color:var(--viz-text);background:var(--viz-accent-bg-subtle);border-radius:0 12px 12px 0;padding:10px 12px}main [data-tooltip]{position:relative}main [data-tooltip]:after{z-index:20;border:1px solid var(--viz-border);width:max-content;max-width:min(220px,100vw - 24px);color:var(--viz-text);background:var(--main-surface-primary);box-shadow:0 2px 8px color-mix(in srgb, var(--viz-text) 8%, transparent);content:attr(data-tooltip);opacity:0;pointer-events:none;text-align:start;border-radius:10px;padding:4px 8px;font-size:12px;line-height:1.4;transition:opacity .12s,transform .12s;position:absolute;bottom:calc(100% + 6px);left:50%;transform:translate(-50%,2px)}main [data-tooltip]:is(:hover,:focus-visible):after{opacity:1;transform:translate(-50%)}main [data-tooltip-placement=bottom]:after{top:calc(100% + 6px);bottom:auto;transform:translate(-50%,-2px)}main [data-tooltip-placement=bottom]:is(:hover,:focus-visible):after{transform:translate(-50%)}main [data-tooltip-placement=left]:after{inset:50% calc(100% + 6px) auto auto;transform:translate(2px,-50%)}main [data-tooltip-placement=left]:is(:hover,:focus-visible):after{transform:translateY(-50%)}main [data-tooltip-placement=right]:after{top:50%;bottom:auto;left:calc(100% + 6px);transform:translate(-2px,-50%)}main [data-tooltip-placement=right]:is(:hover,:focus-visible):after{transform:translateY(-50%)}:where(svg){max-width:100%;height:auto}:root.dark :where(.bg-white){background-color:var(--main-surface-primary)}:root.dark :where(.bg-slate-50,.bg-gray-50,.bg-zinc-50,.bg-neutral-50){background-color:var(--main-surface-secondary)}:root.dark :where(.bg-slate-100,.bg-gray-100,.bg-zinc-100,.bg-neutral-100,.bg-slate-200,.bg-gray-200,.bg-zinc-200,.bg-neutral-200){background-color:var(--main-surface-tertiary)}:root.dark :where(.bg-black,.bg-slate-900,.bg-gray-900,.bg-zinc-900,.bg-neutral-900,.bg-blue-600,.bg-blue-700){background-color:var(--interactive-bg-primary-default)}:root.dark :where(.text-white){color:var(--text-primary-inverse)}:root.dark :where(.text-black,.text-slate-900,.text-gray-900,.text-zinc-900,.text-neutral-900,.text-slate-950,.text-gray-950,.text-zinc-950,.text-neutral-950){color:var(--text-primary)}:root.dark :where(.text-slate-500,.text-gray-500,.text-zinc-500,.text-neutral-500,.text-slate-600,.text-gray-600,.text-zinc-600,.text-neutral-600,.text-slate-700,.text-gray-700,.text-zinc-700,.text-neutral-700){color:var(--text-secondary)}:root.dark :where(.text-slate-400,.text-gray-400,.text-zinc-400,.text-neutral-400){color:var(--text-tertiary)}:root.dark :where(.text-blue-500,.text-blue-600,.text-blue-700){color:var(--link)}:root.dark :where(.bg-black,.bg-slate-900,.bg-gray-900,.bg-zinc-900,.bg-neutral-900,.bg-blue-600,.bg-blue-700) :where(.text-white,.text-slate-50,.text-gray-50,.text-zinc-50,.text-neutral-50,.text-slate-100,.text-gray-100,.text-zinc-100,.text-neutral-100){color:var(--text-primary-inverse)}:root.dark :where(.bg-black,.bg-slate-900,.bg-gray-900,.bg-zinc-900,.bg-neutral-900,.bg-blue-600,.bg-blue-700) :where(.text-slate-200,.text-gray-200,.text-zinc-200,.text-neutral-200,.text-slate-300,.text-gray-300,.text-zinc-300,.text-neutral-300,.text-slate-400,.text-gray-400,.text-zinc-400,.text-neutral-400){color:var(--text-secondary-inverse)}:root.dark :where(.border-slate-200,.border-gray-200,.border-zinc-200,.border-neutral-200){border-color:var(--border-light)}:root.dark :where(.border-slate-300,.border-gray-300,.border-zinc-300,.border-neutral-300,.border-blue-200,.border-blue-300){border-color:var(--border-medium)}`})),Gt=e((()=>{})),Kt,qt=e((()=>{Gt(),Kt=`/cdn/assets/app-block-sandbox-b1cs4d5m.css`}));function Jt(e,t){return t||=e.slice(0),Object.freeze(Object.defineProperties(e,{raw:{value:Object.freeze(t)}}))}var Y=e((()=>{}));function Yt(e){return/<!doctype\b|<html[\s>]/i.test(e)}function Xt(e,t){let n=e.match(/<\/body\s*>(?=\s*(?:<\/html\s*>)?\s*$)/i)??e.match(/<\/html\s*>\s*$/i);if(n?.index==null)return`${e}\n${t}`;let r=n.index;return[e.slice(0,r),t,e.slice(r)].join(`
`)}function Zt(e){let t=e.trim().replaceAll(`_`,`-`);return t.length===0||!/^[A-Za-z0-9-]+$/.test(t)?`en`:t}function Qt(e){if(/^https?:\/\//i.test(e)||typeof window>`u`)return e;let t=window.location.origin;return new URL(e,t).toString()}function $t(e){try{return new URL(e).origin}catch{return null}}function en(e){return ln.has(e)?e:`default`}function tn(e=[]){let t=Qt(Kt),n=Qt(Vt),r=[$t(on),$t(sn),$t(t),$t(n),...cn,...e.map($t)];return Array.from(new Set(r.filter(e=>e!=null)))}function nn(e,t=`light`,n=`en`,r=`default`,i=`inline`,{loadTailwind:a=!0,platform:o,progressiveStreaming:s=!1,syncPresentationSurface:c=!1,styleMode:l=`default`}={}){let u=e.trim(),d=c?dn:``;if(!s&&Yt(u))return{html:c?Xt(u,d):u,expectReadySignal:!1};let f=Zt(n),p=l===`open`?Rt:Ut,m=Qt(l===`open`?Vt:Kt),h=en(r),g=t===`dark`?`#212121`:`#ffffff`,_=i===`skybridge`&&o!=null&&o!==`web`||i===`inline`,v=[`color-scheme: ${t};`,_?`background-color: transparent;`:`background-color: var(--main-surface-primary, ${g});`].join(` `);return{expectReadySignal:a,frameColorScheme:t,html:`<!doctype html>
<html ${[`lang="${f}"`,`class="${t}"`,`data-chat-theme="${h}"`,`data-app-block-surface="${i}"`,`data-app-block-style-mode="${l}"`,o==null?null:`data-app-block-platform="${o}"`,`style="${v}"`].filter(e=>e!=null).join(` `)}>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="${t}" />
    ${a?`<script>
      window.tailwind = window.tailwind || {};
      window.tailwind.config = { darkMode: "class" };
    <\/script>
    <script id="app-block-tailwind" src="${on}" defer><\/script>
    <script>
      (() => {
        const tailwindScript = document.getElementById("app-block-tailwind");
        const markFatal = () => {
          document.documentElement.setAttribute("data-fatal", "");
        };

        if (!(tailwindScript instanceof HTMLScriptElement)) {
          markFatal();
          return;
        }

        tailwindScript.addEventListener("error", markFatal, { once: true });
        tailwindScript.addEventListener(
          "load",
          () => {
            const readinessProbe = document.createElement("div");
            readinessProbe.className = "hidden";
            readinessProbe.setAttribute("aria-hidden", "true");

            const markReadyWhenStyled = () => {
              if (getComputedStyle(readinessProbe).display !== "none") {
                return;
              }

              styleObserver.disconnect();
              readinessProbe.remove();
              document.documentElement.setAttribute("data-ready", "");
            };
            const styleObserver = new MutationObserver(markReadyWhenStyled);
            styleObserver.observe(document.head, {
              childList: true,
              characterData: true,
              subtree: true,
            });

            document.body.append(readinessProbe);
            markReadyWhenStyled();
          },
          { once: true }
        );
      })();
    <\/script>`:``}
    ${a?`<link rel="stylesheet" href="${m}" />`:`<style>${p}</style>`}
    ${s?un:``}
  </head>
  <body>
    <main>
${s?``:u}
    </main>
    ${d}
    ${s?fn:``}
  </body>
</html>`}}var rn,an,on,sn,cn,ln,un,dn,fn,pn=e((()=>{zt(),Ht(),Wt(),qt(),Y(),on=`https://cdn.tailwindcss.com`,sn=`https://images.openai.com`,cn=[`https://persistent.oaistatic.com`,`https://cdnjs.cloudflare.com`,`https://esm.sh`,`https://cdn.jsdelivr.net`,`https://unpkg.com`,`https://fonts.googleapis.com`,`https://fonts.gstatic.com`,`https://fonts.bunny.net`],ln=new Set([`default`,`blue`,`green`,`yellow`,`purple`,`pink`,`orange`,`black`]),un=`<style>
  @media (prefers-reduced-motion: no-preference) {
    [data-app-block-stream-enter] {
      animation: app-block-stream-enter 160ms ease-out both;
    }

    @keyframes app-block-stream-enter {
      from { opacity: 0; }
      to { opacity: 1; }
    }
  }
</style>`,dn=String.raw(rn||=Jt([`<script>
  (() => {
    function updateSurface(surface) {
      if (surface !== "inline" && surface !== "stage") {
        return;
      }

      const root = document.documentElement;
      const isDarkMode = root.classList.contains("dark");
      const stageBackground = isDarkMode ? "#212121" : "#ffffff";
      root.setAttribute("data-app-block-surface", surface);
      root.style.backgroundColor =
        surface === "inline"
          ? "transparent"
          : "var(--main-surface-primary, " + stageBackground + ")";
    }

    window.addEventListener("openai:set_globals", (event) => {
      const surface = event.detail?.globals?.__appBlockSurface;
      if (surface != null) {
        updateSurface(surface);
      }
    });

    const initialSurface =
      window.openai?.__appBlockSurface ??
      document.documentElement.getAttribute("data-app-block-surface") ??
      "inline";
    updateSurface(initialSurface);
  })();
<\/script>`])),fn=String.raw(an||=Jt([`<script>
  (() => {
    const root = document.querySelector("main");
    if (!(root instanceof HTMLElement)) {
      return;
    }

    let hasFinalized = false;
    let previousHtml = null;

    function getRenderableHtml(html, isFinal) {
      if (isFinal) {
        return html;
      }

      let renderableHtml = html;
      const trailingTagStart = renderableHtml.lastIndexOf("<");
      if (trailingTagStart >= 0) {
        const trailingTag = renderableHtml.slice(trailingTagStart).toLowerCase();
        if ("</appblock>".startsWith(trailingTag)) {
          renderableHtml = renderableHtml.slice(0, trailingTagStart);
        }
      }

      const lowercaseHtml = renderableHtml.toLowerCase();
      const lastStyleStart = lowercaseHtml.lastIndexOf("<style");
      const lastStyleEnd = lowercaseHtml.lastIndexOf("</style");
      if (lastStyleStart > lastStyleEnd) {
        return renderableHtml.slice(0, lastStyleStart);
      }

      return renderableHtml;
    }

    function removePartialExecutionAttributes(fragment) {
      for (const element of fragment.querySelectorAll("*")) {
        for (const attribute of Array.from(element.attributes)) {
          const attributeName = attribute.name.toLowerCase();
          if (attributeName.startsWith("on") || attributeName === "srcdoc") {
            element.removeAttribute(attribute.name);
            continue;
          }

          if (
            /^(?:href|src|action|formaction|xlink:href)$/i.test(attribute.name) &&
            /^s*javascript:/i.test(attribute.value)
          ) {
            element.removeAttribute(attribute.name);
          }
        }

        if (element.matches("button, input, select, textarea, fieldset")) {
          element.setAttribute("disabled", "");
        }
        if (element.matches("a[href]")) {
          element.removeAttribute("href");
          element.setAttribute("aria-disabled", "true");
        }
        if (element.hasAttribute("contenteditable")) {
          element.setAttribute("contenteditable", "false");
        }
      }
    }

    function markNewElement(node) {
      if (!(node instanceof Element) || node.tagName === "STYLE") {
        return;
      }

      node.setAttribute("data-app-block-stream-enter", "");
      node.addEventListener(
        "animationend",
        () => node.removeAttribute("data-app-block-stream-enter"),
        { once: true }
      );
    }

    function synchronizeAttributes(currentElement, nextElement) {
      for (const attribute of Array.from(currentElement.attributes)) {
        if (
          attribute.name !== "data-app-block-stream-enter" &&
          !nextElement.hasAttribute(attribute.name)
        ) {
          currentElement.removeAttribute(attribute.name);
        }
      }

      for (const attribute of Array.from(nextElement.attributes)) {
        if (currentElement.getAttribute(attribute.name) !== attribute.value) {
          currentElement.setAttribute(attribute.name, attribute.value);
        }
      }
    }

    function synchronizeChildren(currentParent, nextParent, isFinal) {
      let currentChild = currentParent.firstChild;

      for (const nextChild of Array.from(nextParent.childNodes)) {
        if (currentChild === null) {
          const insertedChild = nextChild.cloneNode(true);
          currentParent.appendChild(insertedChild);
          markNewElement(insertedChild);
          continue;
        }

        const isMatchingNode =
          currentChild.nodeType === nextChild.nodeType &&
          currentChild.nodeName === nextChild.nodeName;
        if (!isMatchingNode) {
          const insertedChild = nextChild.cloneNode(true);
          currentParent.replaceChild(insertedChild, currentChild);
          markNewElement(insertedChild);
          currentChild = insertedChild.nextSibling;
          continue;
        }

        if (currentChild instanceof Element && nextChild instanceof Element) {
          synchronizeAttributes(currentChild, nextChild);
          synchronizeChildren(currentChild, nextChild, isFinal);
        } else if (currentChild.nodeValue !== nextChild.nodeValue) {
          currentChild.nodeValue = nextChild.nodeValue;
        }

        currentChild = currentChild.nextSibling;
      }

      if (!isFinal) {
        return;
      }

      while (currentChild !== null) {
        const nextCurrentChild = currentChild.nextSibling;
        currentChild.remove();
        currentChild = nextCurrentChild;
      }
    }

    function applyStreamUpdate(update) {
      if (
        hasFinalized ||
        update === null ||
        typeof update !== "object" ||
        typeof update.html !== "string"
      ) {
        return;
      }

      const isFinal = update.isFinal === true;
      if (!isFinal && previousHtml === update.html) {
        return;
      }
      previousHtml = update.html;

      const template = document.createElement("template");
      template.innerHTML = getRenderableHtml(update.html, isFinal);
      const scripts = Array.from(template.content.querySelectorAll("script"));
      for (const script of scripts) {
        script.remove();
      }

      if (!isFinal) {
        removePartialExecutionAttributes(template.content);
      }

      synchronizeChildren(root, template.content, isFinal);

      if (!isFinal) {
        return;
      }

      hasFinalized = true;
      for (const sourceScript of scripts) {
        const executableScript = document.createElement("script");
        for (const attribute of Array.from(sourceScript.attributes)) {
          executableScript.setAttribute(attribute.name, attribute.value);
        }
        executableScript.textContent = sourceScript.textContent;
        root.appendChild(executableScript);
      }
    }

    window.addEventListener("openai:set_globals", (event) => {
      const globals = event.detail && event.detail.globals;
      if (globals && Object.hasOwn(globals, "__appBlockStream")) {
        applyStreamUpdate(globals.__appBlockStream);
      }
    });

    if (window.openai && window.openai.__appBlockStream) {
      applyStreamUpdate(window.openai.__appBlockStream);
    }
  })();
<\/script>`],[`<script>
  (() => {
    const root = document.querySelector("main");
    if (!(root instanceof HTMLElement)) {
      return;
    }

    let hasFinalized = false;
    let previousHtml = null;

    function getRenderableHtml(html, isFinal) {
      if (isFinal) {
        return html;
      }

      let renderableHtml = html;
      const trailingTagStart = renderableHtml.lastIndexOf("<");
      if (trailingTagStart >= 0) {
        const trailingTag = renderableHtml.slice(trailingTagStart).toLowerCase();
        if ("</appblock>".startsWith(trailingTag)) {
          renderableHtml = renderableHtml.slice(0, trailingTagStart);
        }
      }

      const lowercaseHtml = renderableHtml.toLowerCase();
      const lastStyleStart = lowercaseHtml.lastIndexOf("<style");
      const lastStyleEnd = lowercaseHtml.lastIndexOf("</style");
      if (lastStyleStart > lastStyleEnd) {
        return renderableHtml.slice(0, lastStyleStart);
      }

      return renderableHtml;
    }

    function removePartialExecutionAttributes(fragment) {
      for (const element of fragment.querySelectorAll("*")) {
        for (const attribute of Array.from(element.attributes)) {
          const attributeName = attribute.name.toLowerCase();
          if (attributeName.startsWith("on") || attributeName === "srcdoc") {
            element.removeAttribute(attribute.name);
            continue;
          }

          if (
            /^(?:href|src|action|formaction|xlink:href)$/i.test(attribute.name) &&
            /^\\s*javascript:/i.test(attribute.value)
          ) {
            element.removeAttribute(attribute.name);
          }
        }

        if (element.matches("button, input, select, textarea, fieldset")) {
          element.setAttribute("disabled", "");
        }
        if (element.matches("a[href]")) {
          element.removeAttribute("href");
          element.setAttribute("aria-disabled", "true");
        }
        if (element.hasAttribute("contenteditable")) {
          element.setAttribute("contenteditable", "false");
        }
      }
    }

    function markNewElement(node) {
      if (!(node instanceof Element) || node.tagName === "STYLE") {
        return;
      }

      node.setAttribute("data-app-block-stream-enter", "");
      node.addEventListener(
        "animationend",
        () => node.removeAttribute("data-app-block-stream-enter"),
        { once: true }
      );
    }

    function synchronizeAttributes(currentElement, nextElement) {
      for (const attribute of Array.from(currentElement.attributes)) {
        if (
          attribute.name !== "data-app-block-stream-enter" &&
          !nextElement.hasAttribute(attribute.name)
        ) {
          currentElement.removeAttribute(attribute.name);
        }
      }

      for (const attribute of Array.from(nextElement.attributes)) {
        if (currentElement.getAttribute(attribute.name) !== attribute.value) {
          currentElement.setAttribute(attribute.name, attribute.value);
        }
      }
    }

    function synchronizeChildren(currentParent, nextParent, isFinal) {
      let currentChild = currentParent.firstChild;

      for (const nextChild of Array.from(nextParent.childNodes)) {
        if (currentChild === null) {
          const insertedChild = nextChild.cloneNode(true);
          currentParent.appendChild(insertedChild);
          markNewElement(insertedChild);
          continue;
        }

        const isMatchingNode =
          currentChild.nodeType === nextChild.nodeType &&
          currentChild.nodeName === nextChild.nodeName;
        if (!isMatchingNode) {
          const insertedChild = nextChild.cloneNode(true);
          currentParent.replaceChild(insertedChild, currentChild);
          markNewElement(insertedChild);
          currentChild = insertedChild.nextSibling;
          continue;
        }

        if (currentChild instanceof Element && nextChild instanceof Element) {
          synchronizeAttributes(currentChild, nextChild);
          synchronizeChildren(currentChild, nextChild, isFinal);
        } else if (currentChild.nodeValue !== nextChild.nodeValue) {
          currentChild.nodeValue = nextChild.nodeValue;
        }

        currentChild = currentChild.nextSibling;
      }

      if (!isFinal) {
        return;
      }

      while (currentChild !== null) {
        const nextCurrentChild = currentChild.nextSibling;
        currentChild.remove();
        currentChild = nextCurrentChild;
      }
    }

    function applyStreamUpdate(update) {
      if (
        hasFinalized ||
        update === null ||
        typeof update !== "object" ||
        typeof update.html !== "string"
      ) {
        return;
      }

      const isFinal = update.isFinal === true;
      if (!isFinal && previousHtml === update.html) {
        return;
      }
      previousHtml = update.html;

      const template = document.createElement("template");
      template.innerHTML = getRenderableHtml(update.html, isFinal);
      const scripts = Array.from(template.content.querySelectorAll("script"));
      for (const script of scripts) {
        script.remove();
      }

      if (!isFinal) {
        removePartialExecutionAttributes(template.content);
      }

      synchronizeChildren(root, template.content, isFinal);

      if (!isFinal) {
        return;
      }

      hasFinalized = true;
      for (const sourceScript of scripts) {
        const executableScript = document.createElement("script");
        for (const attribute of Array.from(sourceScript.attributes)) {
          executableScript.setAttribute(attribute.name, attribute.value);
        }
        executableScript.textContent = sourceScript.textContent;
        root.appendChild(executableScript);
      }
    }

    window.addEventListener("openai:set_globals", (event) => {
      const globals = event.detail && event.detail.globals;
      if (globals && Object.hasOwn(globals, "__appBlockStream")) {
        applyStreamUpdate(globals.__appBlockStream);
      }
    });

    if (window.openai && window.openai.__appBlockStream) {
      applyStreamUpdate(window.openai.__appBlockStream);
    }
  })();
<\/script>`]))}));function mn(){"use forget";let e=(0,hn.useContext)(gn);if(e==null)throw Error(`useAppBlockExpandedView must be used within AppBlockExpandedViewProvider`);return e}var hn,gn,_n=e((()=>{hn=n(I()),gn=(0,hn.createContext)(null)})),vn,yn=e((()=>{b(),L(),vn=u(()=>ue(()=>import(`./7aa2b76f-jkj9ryhr2nwb0g78.js`).then(e=>e.AppBlockFullscreenTurnComposer),__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11])))}));function bn(e){"use forget";let t=(0,Cn.c)(42),{additionalResourceDomains:n,canSubmitTurn:r,children:a,code:o,conversationId:s,headerAction:c,source:l,styleMode:u,title:d}=e,f=`app-block:${l.appBlockId}:${(0,wn.useId)()}`,p=(0,wn.useRef)(null),[m,h]=(0,wn.useState)(null),g=l.appBlockId,_=l.libraryFileId,v=l.messageId,y=l.refIndex,b=s??null,ee;t[0]!==b||t[1]!==g?(ee={appBlockId:g,conversationId:b},t[0]=b,t[1]=g,t[2]=ee):ee=t[2];let x=ee,S=i(ye),C;t[3]!==S||t[4]!==x?(C=Pe(S,x),t[3]=S,t[4]=x,t[5]=C):C=t[5];let w=C,te=S?.appBlockId===g&&S.conversationId===b&&(S.isOriginalVersion===!0||S.versionNumber!=null),ne=w||te,T;t[6]!==S||t[7]!==f||t[8]!==x?(T=W(S,x,f),t[6]=S,t[7]=f,t[8]=x,t[9]=T):T=t[9];let E=T,D;t[10]===Symbol.for(`react.memo_cache_sentinel`)?(D=()=>{p.current?.focus()},t[10]=D):D=t[10];let re=D,ie=m?.supportsAtomicMove?m:void 0,O;t[11]!==g||t[12]!==_||t[13]!==v||t[14]!==y?(O={appBlockId:g,libraryFileId:_,messageId:v,refIndex:y},t[11]=g,t[12]=_,t[13]=v,t[14]=y,t[15]=O):O=t[15];let k;t[16]!==n||t[17]!==r||t[18]!==o||t[19]!==c||t[20]!==u||t[21]!==ie||t[22]!==O||t[23]!==d?(k={additionalResourceDomains:n,canSubmitTurn:r,code:o,focusOnClose:re,headerAction:c,sharedPreview:ie,source:O,styleMode:u,title:d},t[16]=n,t[17]=r,t[18]=o,t[19]=c,t[20]=u,t[21]=ie,t[22]=O,t[23]=d,t[24]=k):k=t[24];let A=k,j,M;t[25]!==A||t[26]!==w||t[27]!==x?(j=()=>{w&&ve(x,A)},M=[A,w,x],t[25]=A,t[26]=w,t[27]=x,t[28]=j,t[29]=M):(j=t[28],M=t[29]),(0,wn.useEffect)(j,M);let N;t[30]!==A||t[31]!==E||t[32]!==x?(N=()=>{Ne(x,E,A)},t[30]=A,t[31]=E,t[32]=x,t[33]=N):N=t[33];let ae=N,oe;t[34]!==ne||t[35]!==te||t[36]!==ae||t[37]!==m?(oe={isExpanded:ne,isViewingHistoricalVersion:te,openExpandedView:ae,setSharedPreview:h,sharedPreview:m,triggerRef:p},t[34]=ne,t[35]=te,t[36]=ae,t[37]=m,t[38]=oe):oe=t[38];let se=oe,ce;return t[39]!==a||t[40]!==se?(ce=(0,Tn.jsx)(gn.Provider,{value:se,children:a}),t[39]=a,t[40]=se,t[41]=ce):ce=t[41],ce}function xn(e){"use forget";let t=(0,Cn.c)(17),{canSubmitFullscreenTurn:n,children:r,conversation:a,headerAction:o,headerTitleContent:s,title:c}=e,l=q(),u;t[0]===a?u=t[1]:(u=()=>a==null?0:Ee(a).height$()??0,t[0]=a,t[1]=u);let d=i(u),f=l===`fullscreen`&&n&&a!=null?d:0,p=s??c,m;t[2]===p?m=t[3]:(m=(0,Tn.jsx)(`span`,{className:`text-token-text-primary min-w-0 flex-1 truncate text-base font-semibold`,children:p}),t[2]=p,t[3]=m);let h;t[4]!==o||t[5]!==m?(h=(0,Tn.jsxs)(_t.Header,{className:`pb-1`,children:[m,o]}),t[4]=o,t[5]=m,t[6]=h):h=t[6];let g;t[7]===f?g=t[8]:(g={paddingBottom:f},t[7]=f,t[8]=g);let _;t[9]===r?_=t[10]:(_=(0,Tn.jsx)(`div`,{className:`h-full min-h-0`,children:r}),t[9]=r,t[10]=_);let v;t[11]!==g||t[12]!==_?(v=(0,Tn.jsx)(_t.Body,{className:`bg-token-bg-primary overflow-hidden`,style:g,children:_}),t[11]=g,t[12]=_,t[13]=v):v=t[13];let y;return t[14]!==h||t[15]!==v?(y=(0,Tn.jsxs)(Tn.Fragment,{children:[h,v]}),t[14]=h,t[15]=v,t[16]=y):y=t[16],y}function Sn(e){"use forget";let t=(0,Cn.c)(5),{conversation:n,paneId:r}=e,i=ht(),a=i.usesViewTransition?i.targetPresentation===`fullscreen`:i.presentation===`fullscreen`&&!i.isTransitioning,o;return t[0]!==n||t[1]!==r||t[2]!==i.isTransitioning||t[3]!==a?(o=a?(0,Tn.jsx)(vn,{conversation:n,disableAutoFocus:i.isTransitioning,paneId:r}):null,t[0]=n,t[1]=r,t[2]=i.isTransitioning,t[3]=a,t[4]=o):o=t[4],o}var Cn,wn,Tn,En=e((()=>{Cn=de(),Me(),gt(),re(),wn=n(I()),_n(),xe(),yn(),Tn=ce()}));function Dn(){"use forget";let e=(0,On.c)(1),t;return e[0]===Symbol.for(`react.memo_cache_sentinel`)?(t=(0,kn.jsx)(`div`,{className:`text-token-text-secondary flex h-full min-h-[120px] w-full items-center justify-center p-4 text-center text-sm`,role:`status`,children:(0,kn.jsx)(F,{id:`chatgpt.app_block.preview.code_execution_disabled`,defaultMessage:`Code execution is disabled for this workspace.`})}),e[0]=t):t=e[0],t}var On,kn,An=e((()=>{On=de(),le(),kn=ce()}));function jn(e,t,n){"use forget";let r=(0,Nn.c)(11),i=t===void 0||t,a=fe(),o;r[0]!==a||r[1]!==e?(o=e?a.formatMessage(X.generatingApp,{title:e}):a.formatMessage(X.creatingInterface),r[0]=a,r[1]=e,r[2]=o):o=r[2];let s=o,c;r[3]!==s||r[4]!==a||r[5]!==n?(c=n??[s,a.formatMessage(X.sketchingInterface),a.formatMessage(X.shapingLayout),a.formatMessage(X.arrangingPieces),a.formatMessage(X.polishingVisuals),a.formatMessage(X.tuningInputs),a.formatMessage(X.addingInteractivity),a.formatMessage(X.wiringControls),a.formatMessage(X.composingInteractions),a.formatMessage(X.calibratingPreview),a.formatMessage(X.refiningDetails)],r[3]=s,r[4]=a,r[5]=n,r[6]=c):c=r[6];let l=c,[u,d]=(0,Pn.useState)(0),f,p;return r[7]!==i||r[8]!==l.length?(f=()=>{if(!i)return;let e=window.setInterval(()=>{d(e=>Math.min(e+1,l.length-1))},In);return()=>{window.clearInterval(e)}},p=[i,l.length],r[7]=i,r[8]=l.length,r[9]=f,r[10]=p):(f=r[9],p=r[10]),(0,Pn.useEffect)(f,p),l[u]??l[0]??``}function Mn(e){"use forget";let t=(0,Nn.c)(2),{loadingLabels:n,title:r}=e,i=jn(r,!0,n),a;return t[0]===i?a=t[1]:(a=(0,Fn.jsx)(`div`,{"aria-atomic":`true`,"aria-live":`polite`,className:`not-prose mt-4 mb-1 flex min-h-[220px] w-full cursor-wait`,role:`status`,children:(0,Fn.jsx)(nt,{className:`aspect-auto min-h-0 flex-1 pt-2`,label:i})}),t[0]=i,t[1]=a),a}var Nn,Pn,Fn,In,X,Ln,Rn=e((()=>{Nn=de(),tt(),f(),Pn=n(I()),le(),Fn=ce(),In=2800,X=P({generatingApp:{id:`appBlock.loadingState.generatingApp`,defaultMessage:`Generating {title}`},creatingInterface:{id:`appBlock.loadingState.creatingInterface`,defaultMessage:`Creating the interface`},sketchingInterface:{id:`appBlock.loadingState.sketchingInterface`,defaultMessage:`Sketching the interface`},shapingLayout:{id:`appBlock.loadingState.shapingLayout`,defaultMessage:`Shaping the layout`},arrangingPieces:{id:`appBlock.loadingState.arrangingPieces`,defaultMessage:`Arranging the pieces`},polishingVisuals:{id:`appBlock.loadingState.polishingVisuals`,defaultMessage:`Polishing the visuals`},tuningInputs:{id:`appBlock.loadingState.tuningInputs`,defaultMessage:`Tuning the inputs`},addingInteractivity:{id:`appBlock.loadingState.addingInteractivity`,defaultMessage:`Adding interactivity`},wiringControls:{id:`appBlock.loadingState.wiringControls`,defaultMessage:`Wiring the controls`},composingInteractions:{id:`appBlock.loadingState.composingInteractions`,defaultMessage:`Composing the interactions`},calibratingPreview:{id:`appBlock.loadingState.calibratingPreview`,defaultMessage:`Calibrating the preview`},refiningDetails:{id:`appBlock.loadingState.refiningDetails`,defaultMessage:`Refining the details`}}),Ln=e=>{"use forget";let t=(0,Nn.c)(11),{isVisible:n,title:r}=e,i=jn(r,n),a=!n,o=n?`grid-rows-[1fr] opacity-100`:`grid-rows-[0fr] opacity-0`,c;t[0]===o?c=t[1]:(c=s(`grid shrink-0 transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none`,o),t[0]=o,t[1]=c);let l=n&&`loading-shimmer-pure-text motion-reduce:animate-none`,u;t[2]===l?u=t[3]:(u=s(`text-token-text-secondary inline-block font-sans font-medium`,l),t[2]=l,t[3]=u);let d;t[4]!==i||t[5]!==u?(d=(0,Fn.jsx)(`div`,{className:`min-h-0 overflow-hidden`,children:(0,Fn.jsx)(`div`,{className:`pb-3`,children:(0,Fn.jsx)(`span`,{className:u,children:i})})}),t[4]=i,t[5]=u,t[6]=d):d=t[6];let f;return t[7]!==a||t[8]!==c||t[9]!==d?(f=(0,Fn.jsx)(`div`,{"aria-atomic":`true`,"aria-hidden":a,"aria-live":`polite`,className:c,role:`status`,children:d}),t[7]=a,t[8]=c,t[9]=d,t[10]=f):f=t[10],f}}));function zn({appBlockId:e,conversation:t}){return t==null?null:ct(t).get(e)??null}function Bn(e){return e?.serverId$()??void 0}function Vn({currentContentFileId:e,libraryFileId:t,libraryFileVersionNumber:n,serverThreadId:r,source:i}){let a=i?.libraryFileId??t??null,o=i?.currentContentFileId??e??(a==null?null:ge(a));return{contentFileId:o,libraryContentKey:[a,o,i?.latestPatchMessageId??i?.libraryFileVersionNumber??n??i?.currentContentFileId??e??null,r??null].join(`\0`),libraryFileId:a}}function Hn({contentFileId:e,libraryContentKey:t,libraryFileId:n,onContentStateChange:r,serverThreadId:i}){if(n==null||e==null){r(null);return}let a=new AbortController;return Oe({abortSignal:a.signal,fileId:e,serverThreadId:i}).then(e=>{a.signal.aborted||r({content:e,key:t,status:`loaded`})}).catch(e=>{a.signal.aborted||r({content:null,key:t,status:v(e)?`missing`:`failed`})}),()=>{a.abort()}}function Un({appBlockId:e,contentFileId:t,currentContentFileId:n,libraryContent:r,libraryContentKey:i,libraryFileId:a,libraryFileVersionNumber:o,source:s}){let c=s??Wn({appBlockId:e,contentFileId:t,currentContentFileId:n,libraryFileId:a,libraryFileVersionNumber:o});return c==null?null:r==null||r.key!==i?c.latestPatchMessageId!=null&&c.content==null?{...c,content:null}:c:{...c,content:r.content}}function Wn({appBlockId:e,contentFileId:t,currentContentFileId:n,libraryFileId:r,libraryFileVersionNumber:i}){return r==null?null:{appBlockId:e,content:null,currentContentFileId:n??t,entrypoint:null,iconSvg:null,language:`html`,latestPatchMessageId:null,libraryFileId:r,libraryFileName:null,libraryFileVersionNumber:i??null,messageId:``,mimeType:null,refIndex:0,styleMode:null,title:null}}var Gn=e((()=>{_(),z(),ot()})),Kn=t({AppBlock:()=>Yn,AppBlockCollapsedPreview:()=>rr,AppBlockPreviewLoadingState:()=>mr,AppBlockSandboxPreview:()=>dr});function qn(e){let t=e.search(kr),n=t===-1?e:e.slice(0,t),r=n.toLowerCase(),i=r.lastIndexOf(`<style`);return i>r.lastIndexOf(`</style`)&&(n=n.slice(0,i)),n}function Jn(e){let t=qn(e);if(t.trim()===``)return!1;if(typeof document>`u`)return/<[^>]+>|[^\s<]/.test(t);let n=document.createElement(`template`);n.innerHTML=t;for(let e of n.content.querySelectorAll(Ar))e.remove();return(n.content.textContent?.trim().length??0)>0||n.content.querySelector(jr)!=null}function Yn(e){"use forget";let t=(0,Z.c)(153),{additionalResourceDomains:n,appBlockId:r,authoritativeCode:a,authoritativeSource:o,bind:s,code:c,collapseWhenSuperseded:l,currentContentFileId:u,displayMode:d,editingEnabled:f,expandedHeaderAction:p,expandedViewEnabled:m,id:h,captureConsoleMessages:g,clientThreadId:_,iconSvg:v,inlineHeight:y,isStreaming:b,isTurnStreaming:ee,libraryFileId:x,libraryFileVersionNumber:S,loadingLabels:C,messageId:w,onConsoleMessagesChange:T,onReadyChange:E,previewLoadingLabel:D,progressiveStreaming:re,ref:O,refIndex:k,styleMode:A,title:j,variant:N,wasStreamingWhenFirstSeen:ae,widgetName:oe,widgetRefSeenAtMs:se}=e,ce=l===void 0||l,P=g!==void 0&&g,F=b!==void 0&&b,le=ee!==void 0&&ee,I=re!==void 0&&re,ue=N===void 0?`inline`:N,L=ie(),de=(0,Q.useContext)(ut),fe;t[0]===L?fe=t[1]:(fe=()=>L!=null&&Te(L),t[0]=L,t[1]=fe);let pe=i(fe),me;t[2]!==_||t[3]!==L?(me=_==null?L:M(_),t[2]=_,t[3]=L,t[4]=me):me=t[4];let he=me,ge=w!=null&&k!=null?st({messageId:w,refIndex:k}):void 0,R=r??ge??st({messageId:w??h,refIndex:k??0}),_e=i(()=>je({conversation:L??null,instanceId:R,messageId:w,refIndex:k}))??d,ve=i(()=>o!=null||_e!=null?null:zn({appBlockId:R,conversation:L??null})),z=o??ve,ye;t[5]===L?ye=t[6]:(ye=()=>Bn(L??null),t[5]=L,t[6]=ye);let be=i(ye),xe=ne(L?.id),B=be??xe,V;t[7]!==u||t[8]!==x||t[9]!==S||t[10]!==B||t[11]!==z?(V=Vn({currentContentFileId:u,libraryFileId:x,libraryFileVersionNumber:S,serverThreadId:B,source:z}),t[7]=u,t[8]=x,t[9]=S,t[10]=B,t[11]=z,t[12]=V):V=t[12];let U=V,[Se,Ce]=(0,Q.useState)(null),[we,Ee]=(0,Q.useState)(0),De;t[13]!==we||t[14]!==U.libraryContentKey?(De=[U.libraryContentKey,we],t[13]=we,t[14]=U.libraryContentKey,t[15]=De):De=t[15];let ke=De.join(`\0`),Ae,Me;t[16]!==a||t[17]!==ke||t[18]!==U.contentFileId||t[19]!==U.libraryFileId||t[20]!==_e||t[21]!==B?(Ae=()=>{if(!(a!=null||_e===`collapsed`))return Hn({contentFileId:U.contentFileId,libraryContentKey:ke,libraryFileId:U.libraryFileId,onContentStateChange:Ce,serverThreadId:B})},Me=[a,U.contentFileId,U.libraryFileId,ke,_e,B],t[16]=a,t[17]=ke,t[18]=U.contentFileId,t[19]=U.libraryFileId,t[20]=_e,t[21]=B,t[22]=Ae,t[23]=Me):(Ae=t[22],Me=t[23]),(0,Q.useEffect)(Ae,Me);let W=Un({appBlockId:R,contentFileId:U.contentFileId,currentContentFileId:u,libraryContent:Se,libraryContentKey:ke,libraryFileId:x,libraryFileVersionNumber:S,source:z}),Pe=Se?.key===ke?Se:null,Ie;t[24]!==W?.libraryFileId||t[25]!==x?(Ie=()=>Fe(W?.libraryFileId??x),t[24]=W?.libraryFileId,t[25]=x,t[26]=Ie):Ie=t[26];let Le=i(Ie),Re=W?.libraryFileVersionNumber??S,ze=Le!=null&&(Re==null||Le.versionNumber>=Re)?Le.code:void 0,G=ze??a??W?.content??c??null,Be=W?.iconSvg??v??null,Ve=W?.libraryFileId??x,He=Ve==null&&a==null&&ze==null&&u==null&&z?.currentContentFileId==null&&z?.latestPatchMessageId==null,Ue=ae===!1&&ue===`inline`&&He,We;t[27]!==c||t[28]!==He||t[29]!==w||t[30]!==G||t[31]!==k||t[32]!==z?(We=He?z==null?w!=null&&k!=null&&c!=null&&G===c?{messageId:w,refIndex:k}:null:z.messageId.length>0&&z.content!=null&&G===z.content?{messageId:z.messageId,refIndex:z.refIndex}:null:null,t[27]=c,t[28]=He,t[29]=w,t[30]=G,t[31]=k,t[32]=z,t[33]=We):We=t[33];let Ge=We,Ke=ue===`artifact`,qe=W?.styleMode??A??(Ke&&I?`open`:void 0),Je;t[34]!==Ve||t[35]!==qe?(Je=at({explicitStyleMode:qe,libraryFileId:Ve}),t[34]=Ve,t[35]=qe,t[36]=Je):Je=t[36];let Ye=Je,K=W?.title??j,Xe;t[37]===L?Xe=t[38]:(Xe=()=>L!=null&&te(L)?`work`:`chat`,t[37]=L,t[38]=Xe);let Ze=i(Xe),Qe;t[39]===f?Qe=t[40]:(Qe=f??yt(),t[39]=f,t[40]=Qe);let $e=Qe,et=m??$e,tt=I,nt=Ke&&Ye===`open`,rt=_e===`collapsed`||_e==null&&ce&&W?.latestPatchMessageId!=null&&W.latestPatchMessageId!==w,it=c!=null||u!=null,ot;t[41]!==$e||t[42]!==_||t[43]!==c||t[44]!==L?.id||t[45]!==u||t[46]!==R||t[47]!==p||t[48]!==S||t[49]!==w||t[50]!==Ve||t[51]!==Ye||t[52]!==K||t[53]!==k||t[54]!==B||t[55]!==z?.messageId?(ot=async e=>{let t=c;if(t==null&&u!=null)try{t=await Oe({abortSignal:new AbortController().signal,fileId:u,serverThreadId:B})}catch{return}t!=null&&Ne({appBlockId:R,conversationId:L?.id??_??null,isOriginalVersion:!0,versionNumber:S??void 0},`app-block:${R}:original`,{canSubmitTurn:$e,code:t,headerAction:p,focusOnClose:()=>{e.isConnected&&e.focus()},source:{appBlockId:R,libraryFileId:Ve,messageId:z?.messageId??w,refIndex:k},styleMode:Ye,title:K})},t[41]=$e,t[42]=_,t[43]=c,t[44]=L?.id,t[45]=u,t[46]=R,t[47]=p,t[48]=S,t[49]=w,t[50]=Ve,t[51]=Ye,t[52]=K,t[53]=k,t[54]=B,t[55]=z?.messageId,t[56]=ot):ot=t[56],L?.id,z?.messageId;let ct=ot;if(F&&!tt){let e;return t[57]!==C||t[58]!==K?(e=(0,$.jsx)(Mn,{loadingLabels:C,title:K}),t[57]=C,t[58]=K,t[59]=e):e=t[59],e}let lt=pe&&c!=null;if(Pe?.status===`missing`&&!lt)return null;if(rt){let e=it?ct:void 0,n;return t[60]!==K||t[61]!==e?(n=(0,$.jsx)(lr,{onView:e,title:K}),t[60]=K,t[61]=e,t[62]=n):n=t[62],n}let dt=G??(tt&&F?``:null);if(dt==null){if(W?.latestPatchMessageId!=null){let e=L?.id??_,n=Pe?.status===`failed`,r;t[63]===Ee?r=t[64]:(r=()=>Ee(Xn),t[63]=Ee,t[64]=r);let i;return t[65]!==R||t[66]!==Ke||t[67]!==Be||t[68]!==D||t[69]!==K||t[70]!==e||t[71]!==n||t[72]!==r?(i=(0,$.jsx)(er,{appBlockId:R,conversationId:e,hasFailed:n,iconSvg:Be,onRetry:r,previewLoadingLabel:D,showHeader:Ke,title:K}),t[65]=R,t[66]=Ke,t[67]=Be,t[68]=D,t[69]=K,t[70]=e,t[71]=n,t[72]=r,t[73]=i):i=t[73],i}let e;return t[74]!==C||t[75]!==K?(e=(0,$.jsx)(Mn,{loadingLabels:C,title:K}),t[74]=C,t[75]=K,t[76]=e):e=t[76],e}let ft;t[77]!==_||t[78]!==Ze||t[79]!==F||t[80]!==le||t[81]!==w||t[82]!==k?(ft=!F&&!le&&_!=null&&w!=null&&k!=null&&vt()?{reference:{clientThreadId:_,messageId:w,referenceIndex:k},target:{kind:`app_block`,metadata:{tab:Ze}}}:void 0,t[77]=_,t[78]=Ze,t[79]=F,t[80]=le,t[81]=w,t[82]=k,t[83]=ft):ft=t[83];let pt=ft;if(de){let e=L?.id??_,r;t[84]!==n||t[85]!==s||t[86]!==P||t[87]!==R||t[88]!==h||t[89]!==y||t[90]!==F||t[91]!==T||t[92]!==E||t[93]!==D||t[94]!==Ye||t[95]!==K||t[96]!==O||t[97]!==dt||t[98]!==tt||t[99]!==e||t[100]!==ue||t[101]!==se?(r=(0,$.jsx)(dr,{additionalResourceDomains:n,appBlockId:R,bind:s,captureConsoleMessages:P,clientThreadId:e,code:dt,id:h,inlineHeight:y,isStreaming:F,onConsoleMessagesChange:T,onReadyChange:E,previewLoadingLabel:D,progressiveStreaming:tt,ref:O,styleMode:Ye,title:K,variant:ue,widgetRefSeenAtMs:se}),t[84]=n,t[85]=s,t[86]=P,t[87]=R,t[88]=h,t[89]=y,t[90]=F,t[91]=T,t[92]=E,t[93]=D,t[94]=Ye,t[95]=K,t[96]=O,t[97]=dt,t[98]=tt,t[99]=e,t[100]=ue,t[101]=se,t[102]=r):r=t[102];let i;return t[103]!==F||t[104]!==Be||t[105]!==K||t[106]!==nt||t[107]!==r?(i=(0,$.jsx)($n,{canOpen:!1,iconSvg:Be,isShareReady:!1,isStreaming:F,showArtifactCard:nt,title:K,children:r}),t[103]=F,t[104]=Be,t[105]=K,t[106]=nt,t[107]=r,t[108]=i):i=t[108],i}let mt=L?.id??_,ht=z?.messageId??w,gt;t[109]!==R||t[110]!==Ve||t[111]!==k||t[112]!==ht?(gt={appBlockId:R,libraryFileId:Ve,messageId:ht,refIndex:k},t[109]=R,t[110]=Ve,t[111]=k,t[112]=ht,t[113]=gt):gt=t[113];let q=nt&&et&&!F,_t=L?.id??_,J;t[114]!==Ge||t[115]!==oe?(J=Ge==null?void 0:{contentReferenceIndex:Ge.refIndex,messageId:Ge.messageId,widgetName:oe??H.AppBlock,widgetType:H.AppBlock},t[114]=Ge,t[115]=oe,t[116]=J):J=t[116];let bt;t[117]!==n||t[118]!==s||t[119]!==P||t[120]!==R||t[121]!==pt||t[122]!==h||t[123]!==y||t[124]!==Ue||t[125]!==F||t[126]!==T||t[127]!==E||t[128]!==Be||t[129]!==D||t[130]!==Ye||t[131]!==K||t[132]!==O||t[133]!==dt||t[134]!==he||t[135]!==tt||t[136]!==nt||t[137]!==q||t[138]!==_t||t[139]!==J||t[140]!==ue||t[141]!==se?(bt=(0,$.jsx)(Zn,{additionalResourceDomains:n,appBlockId:R,bind:s,canOpen:q,captureConsoleMessages:P,clientThreadId:_t,code:dt,feedback:pt,iconSvg:Be,id:h,inlineHeight:y,isStreaming:F,onConsoleMessagesChange:T,onReadyChange:E,previewLoadingLabel:D,progressiveStreaming:tt,isSavedInlineLoad:Ue,ref:O,showArtifactCard:nt,shareConversation:he,shareTarget:J,styleMode:Ye,title:K,variant:ue,widgetRefSeenAtMs:se}),t[117]=n,t[118]=s,t[119]=P,t[120]=R,t[121]=pt,t[122]=h,t[123]=y,t[124]=Ue,t[125]=F,t[126]=T,t[127]=E,t[128]=Be,t[129]=D,t[130]=Ye,t[131]=K,t[132]=O,t[133]=dt,t[134]=he,t[135]=tt,t[136]=nt,t[137]=q,t[138]=_t,t[139]=J,t[140]=ue,t[141]=se,t[142]=bt):bt=t[142];let xt;return t[143]!==n||t[144]!==$e||t[145]!==p||t[146]!==Ye||t[147]!==K||t[148]!==dt||t[149]!==mt||t[150]!==gt||t[151]!==bt?(xt=(0,$.jsx)(bn,{additionalResourceDomains:n,canSubmitTurn:$e,code:dt,conversationId:mt,headerAction:p,styleMode:Ye,source:gt,title:K,children:bt}),t[143]=n,t[144]=$e,t[145]=p,t[146]=Ye,t[147]=K,t[148]=dt,t[149]=mt,t[150]=gt,t[151]=bt,t[152]=xt):xt=t[152],xt}function Xn(e){return e+1}function Zn(e){"use forget";let t=(0,Z.c)(72),{additionalResourceDomains:n,appBlockId:r,bind:i,canOpen:a,captureConsoleMessages:o,clientThreadId:s,code:c,feedback:l,iconSvg:u,id:d,inlineHeight:f,isStreaming:p,onConsoleMessagesChange:h,onReadyChange:g,previewLoadingLabel:_,progressiveStreaming:v,isSavedInlineLoad:y,ref:b,shareConversation:ee,shareTarget:x,showArtifactCard:S,styleMode:C,title:w,variant:te,widgetRefSeenAtMs:ne}=e,{isExpanded:T,isViewingHistoricalVersion:E,openExpandedView:D,setSharedPreview:re,sharedPreview:ie,triggerRef:O}=mn(),k=(0,Q.useContext)(Ae),A;t[0]===n?A=t[1]:(A=n??[],t[0]=n,t[1]=A);let j;t[2]!==c||t[3]!==d||t[4]!==C||t[5]!==A?(j=[d,C,c,...A],t[2]=c,t[3]=d,t[4]=C,t[5]=A,t[6]=j):j=t[6];let M=j.join(`\0`),[ae,oe]=(0,Q.useState)(null),se=!p&&ae===M,ce;t[7]===D?ce=t[8]:(ce=()=>{R(),D()},t[7]=D,t[8]=ce);let P=ce,F;t[9]!==g||t[10]!==M?(F=(e,t)=>{oe(e?M:null),g?.(e,t)},t[9]=g,t[10]=M,t[11]=F):F=t[11];let le=F,I;t[12]!==n||t[13]!==r||t[14]!==i||t[15]!==o||t[16]!==s||t[17]!==c||t[18]!==le||t[19]!==d||t[20]!==f||t[21]!==y||t[22]!==p||t[23]!==h||t[24]!==_||t[25]!==v||t[26]!==b||t[27]!==C||t[28]!==w||t[29]!==te||t[30]!==ne?(I=(0,$.jsx)(dr,{appBlockId:r,additionalResourceDomains:n,bind:i,code:c,id:d,inlineHeight:f,isStreaming:p,captureConsoleMessages:o,clientThreadId:s,onConsoleMessagesChange:h,onReadyChange:le,presentationSurface:`inline`,previewLoadingLabel:_,progressiveStreaming:v,isSavedInlineLoad:y,ref:b,styleMode:C,title:w,variant:te,widgetRefSeenAtMs:ne}),t[12]=n,t[13]=r,t[14]=i,t[15]=o,t[16]=s,t[17]=c,t[18]=le,t[19]=d,t[20]=f,t[21]=y,t[22]=p,t[23]=h,t[24]=_,t[25]=v,t[26]=b,t[27]=C,t[28]=w,t[29]=te,t[30]=ne,t[31]=I):I=t[31];let ue;t[32]!==k||t[33]!==I?(ue={element:I,sandboxPolicy:k},t[32]=k,t[33]=I,t[34]=ue):ue=t[34];let L=ue,de;t[35]===L?de=t[36]:(de=()=>L,t[35]=L,t[36]=de);let fe=N(de),me;t[37]!==r||t[38]!==s||t[39]!==fe||t[40]!==re?(me=e=>{if(e==null)return;let{preview:t,sourceToken:n}=he({appBlockId:r,content:fe(),conversationId:s??null,inlineContainer:e});return re(t),()=>{let e=ye();pe(t,n,e?.sharedPreview===t)}},t[37]=r,t[38]=s,t[39]=fe,t[40]=re,t[41]=me):me=t[41];let ge=me,_e,ve;t[42]!==L||t[43]!==ie?(ve=()=>{ie!=null&&Se(ie,L)},_e=[L,ie],t[42]=L,t[43]=ie,t[44]=_e,t[45]=ve):(_e=t[44],ve=t[45]),m(ve,_e);let z=E?P:void 0,be;t[46]!==u||t[47]!==z||t[48]!==w||t[49]!==O?(be=(0,$.jsx)(rr,{iconSvg:u,onOpen:z,openButtonRef:O,title:w}),t[46]=u,t[47]=z,t[48]=w,t[49]=O,t[50]=be):be=t[50];let xe=T?be:null,B;t[51]===ge?B=t[52]:(B=(0,$.jsx)(`div`,{ref:ge,className:`w-full`}),t[51]=ge,t[52]=B);let V;t[53]!==a||t[54]!==l||t[55]!==P||t[56]!==u||t[57]!==se||t[58]!==p||t[59]!==ee||t[60]!==x||t[61]!==S||t[62]!==B||t[63]!==w||t[64]!==O?(V=(0,$.jsx)($n,{canOpen:a,expandButtonRef:O,feedback:l,iconSvg:u,isShareReady:se,shareConversation:ee,shareTarget:x,isStreaming:p,showArtifactCard:S,title:w,onOpen:P,children:B}),t[53]=a,t[54]=l,t[55]=P,t[56]=u,t[57]=se,t[58]=p,t[59]=ee,t[60]=x,t[61]=S,t[62]=B,t[63]=w,t[64]=O,t[65]=V):V=t[65];let H;t[66]!==T||t[67]!==V?(H=(0,$.jsx)(`div`,{hidden:T,children:V}),t[66]=T,t[67]=V,t[68]=H):H=t[68];let U;return t[69]!==xe||t[70]!==H?(U=(0,$.jsxs)($.Fragment,{children:[xe,H]}),t[69]=xe,t[70]=H,t[71]=U):U=t[71],U}function Qn(e){"use forget";let t=(0,Z.c)(14),{action:n,className:r,fallbackTitle:i,leading:a,title:o,titleClassName:c}=e,l;t[0]===r?l=t[1]:(l=s(`flex items-center justify-between gap-3`,r),t[0]=r,t[1]=l);let u=c??`truncate text-base font-semibold`,d;t[2]===u?d=t[3]:(d=s(`text-token-text-primary`,u),t[2]=u,t[3]=d);let f=o??i,p;t[4]!==d||t[5]!==f?(p=(0,$.jsx)(`div`,{className:`min-w-0`,children:(0,$.jsx)(`div`,{className:d,children:f})}),t[4]=d,t[5]=f,t[6]=p):p=t[6];let m;t[7]!==a||t[8]!==p?(m=(0,$.jsxs)(`div`,{className:`flex min-w-0 items-center gap-3`,children:[a,p]}),t[7]=a,t[8]=p,t[9]=m):m=t[9];let h;return t[10]!==n||t[11]!==l||t[12]!==m?(h=(0,$.jsxs)(`div`,{className:l,children:[m,n]}),t[10]=n,t[11]=l,t[12]=m,t[13]=h):h=t[13],h}function $n(e){"use forget";let t=(0,Z.c)(20),{canOpen:n,children:r,expandButtonRef:i,feedback:o,iconSvg:c,isShareReady:l,isStreaming:u,onOpen:d,shareConversation:f,shareTarget:p,showArtifactCard:m,title:h}=e,g=fe(),_;t[0]===g?_=t[1]:(_=g.formatMessage({id:`6z1y4r`,defaultMessage:`App preview`}),t[0]=g,t[1]=_);let v=_,y;t[2]!==n||t[3]!==r||t[4]!==i||t[5]!==v||t[6]!==c||t[7]!==l||t[8]!==u||t[9]!==d||t[10]!==f||t[11]!==p||t[12]!==m||t[13]!==h?(y=m?(0,$.jsxs)(`div`,{className:s(`shadow-xxs border-token-border-default bg-token-bg-primary w-full min-w-0 overflow-clip rounded-3xl border`,u&&`cursor-wait`),"data-testid":`app-block-artifact-card`,children:[(0,$.jsx)(Qn,{action:(0,$.jsx)(Mr,{canOpen:n,conversation:f,expandButtonRef:i,isReady:l,onOpen:d,target:p}),className:`min-h-13 px-4 py-2`,fallbackTitle:v,leading:u?(0,$.jsx)(a,{className:`icon-md text-token-text-primary shrink-0`}):(0,$.jsx)(ar,{iconSvg:c}),title:h}),(0,$.jsx)(`div`,{children:r})]}):(0,$.jsx)(Nr,{conversation:f,isReady:l,target:p,children:r}),t[2]=n,t[3]=r,t[4]=i,t[5]=v,t[6]=c,t[7]=l,t[8]=u,t[9]=d,t[10]=f,t[11]=p,t[12]=m,t[13]=h,t[14]=y):y=t[14];let b;t[15]===o?b=t[16]:(b=o==null?null:(0,$.jsx)(tr,{...o}),t[15]=o,t[16]=b);let ee;return t[17]!==y||t[18]!==b?(ee=(0,$.jsxs)(`div`,{className:`group/app-block-preview not-prose mt-4 mb-1 w-full overflow-visible`,"data-app-block-preview":`true`,children:[y,b]}),t[17]=y,t[18]=b,t[19]=ee):ee=t[19],ee}function er(e){"use forget";let t=(0,Z.c)(18),{appBlockId:n,conversationId:r,hasFailed:a,iconSvg:o,onRetry:s,previewLoadingLabel:c,showHeader:l,title:u}=e,d=i(ye),f=fe(),p;t[0]===f?p=t[1]:(p=f.formatMessage({id:`chatgpt.app_block.preview_shell.fallback_title`,defaultMessage:`App preview`}),t[0]=f,t[1]=p);let m=p;if(Pe(d,{appBlockId:n,conversationId:r??null})){let e;return t[2]!==o||t[3]!==u?(e=(0,$.jsx)(rr,{iconSvg:o,title:u}),t[2]=o,t[3]=u,t[4]=e):e=t[4],e}let h;t[5]!==m||t[6]!==o||t[7]!==l||t[8]!==u?(h=l?(0,$.jsx)(Qn,{className:`mb-2`,fallbackTitle:m,leading:(0,$.jsx)(ar,{iconSvg:o}),title:u}):null,t[5]=m,t[6]=o,t[7]=l,t[8]=u,t[9]=h):h=t[9];let g;t[10]===Symbol.for(`react.memo_cache_sentinel`)?(g={minHeight:gr},t[10]=g):g=t[10];let _;t[11]!==a||t[12]!==s||t[13]!==c?(_=(0,$.jsx)(`div`,{className:`relative w-full`,style:g,children:a?(0,$.jsx)(hr,{onRetry:s}):(0,$.jsx)(mr,{label:c})}),t[11]=a,t[12]=s,t[13]=c,t[14]=_):_=t[14];let v;return t[15]!==h||t[16]!==_?(v=(0,$.jsxs)(`div`,{className:`group/app-block-preview not-prose mt-4 mb-1 w-full overflow-visible`,"data-app-block-preview":`true`,children:[h,_]}),t[15]=h,t[16]=_,t[17]=v):v=t[17],v}function tr(e){"use forget";let t=(0,Z.c)(5),{reference:n,target:r}=e,[a,o]=(0,Q.useState)(!1);if(i(nr))return null;let s;t[0]===Symbol.for(`react.memo_cache_sentinel`)?(s=(0,$.jsx)(De,{}),t[0]=s):s=t[0];let c;return t[1]!==a||t[2]!==n||t[3]!==r?(c=(0,$.jsx)(`div`,{className:`flex justify-end pt-1`,children:(0,$.jsx)(et,{onOpenChange:o,open:a,reference:n,target:r,triggerButton:s})}),t[1]=a,t[2]=n,t[3]=r,t[4]=c):c=t[4],c}function nr(){return Qe()}function rr(e){"use forget";let t=(0,Z.c)(23),{iconSvg:n,onOpen:r,openButtonRef:i,title:a}=e,o=fe(),s,c,l,u,d;t[0]!==o||t[1]!==r||t[2]!==i||t[3]!==a?(c=o.formatMessage({id:`XBBNdF`,defaultMessage:`App preview`}),d=`not-prose relative clear-both my-4 w-full max-w-full`,u=`shadow-xxs border-token-border-default bg-token-bg-primary text-token-text-primary flex h-20 w-full min-w-0 items-center gap-3 overflow-clip rounded-3xl border p-4`,s=Qn,l=r==null?void 0:(0,$.jsx)(A,{ref:i,color:`secondary`,label:o.formatMessage({id:`chatgpt.app_block.collapsed_preview.open.aria_label`,defaultMessage:`Open {title} in side pane`},{title:a??c}),onClick:r,type:`button`,children:(0,$.jsx)(F,{id:`chatgpt.app_block.collapsed_preview.open`,defaultMessage:`Open`})}),t[0]=o,t[1]=r,t[2]=i,t[3]=a,t[4]=s,t[5]=c,t[6]=l,t[7]=u,t[8]=d):(s=t[4],c=t[5],l=t[6],u=t[7],d=t[8]);let f;t[9]===n?f=t[10]:(f=(0,$.jsx)(ir,{iconSvg:n}),t[9]=n,t[10]=f);let p;t[11]!==s||t[12]!==c||t[13]!==l||t[14]!==f||t[15]!==a?(p=(0,$.jsx)(s,{action:l,className:`w-full`,fallbackTitle:c,leading:f,title:a,titleClassName:`truncate text-[17px] leading-6 font-medium tracking-[-0.43px]`}),t[11]=s,t[12]=c,t[13]=l,t[14]=f,t[15]=a,t[16]=p):p=t[16];let m;t[17]!==u||t[18]!==p?(m=(0,$.jsx)(`div`,{className:u,children:p}),t[17]=u,t[18]=p,t[19]=m):m=t[19];let h;return t[20]!==d||t[21]!==m?(h=(0,$.jsx)(`div`,{className:d,children:m}),t[20]=d,t[21]=m,t[22]=h):h=t[22],h}function ir(e){"use forget";let t=(0,Z.c)(2),{iconSvg:n}=e,r;return t[0]===n?r=t[1]:(r=(0,$.jsx)(`div`,{className:`bg-token-bg-tertiary flex size-12 shrink-0 items-center justify-center rounded-xl`,children:(0,$.jsx)(ar,{className:`text-token-text-secondary`,iconSvg:n})}),t[0]=n,t[1]=r),r}function ar(e){"use forget";let t=(0,Z.c)(5),{className:n,iconSvg:r}=e,i=n===void 0?`text-token-text-primary`:n,a;t[0]===r?a=t[1]:(a=or(r),t[0]=r,t[1]=a);let o=a,c;return t[2]!==i||t[3]!==o?(c=o==null?(0,$.jsx)(Re,{"aria-hidden":`true`,className:s(`icon-md shrink-0`,i)}):(0,$.jsx)(`span`,{"aria-hidden":`true`,className:s(`icon-md shrink-0`,i),children:(0,$.jsx)(me,{svgString:o,className:`h-full w-full`})}),t[2]=i,t[3]=o,t[4]=c):c=t[4],c}function or(e){if(e==null)return null;let t=e.trim();if(t.length===0||t.length>wr||!t.startsWith(`<svg `)||!t.endsWith(`</svg>`))return null;let n=0,r=!1,i=!1;for(let e of t.matchAll(Tr)){let a=e.index;if(a==null||t.slice(n,a).trim()!==``)return null;n=a+e[0].length;let o=e[1].toLowerCase(),s=e[2]??``;if(!Dr.has(o))return null;o===`svg`&&(r=!0),o===`path`&&(i=!0);let c=e[0].startsWith(`</`);if(c&&s.trim()!==``||!c&&!sr(s))return null}return t.slice(n).trim()===``&&r&&i?t:null}function sr(e){let t=e.replace(Er,``).trim();if(t!==``&&t!==`/`)return!1;for(let t of e.matchAll(Er)){let e=t[1],n=t[2];if(!Or.has(e)||!cr(e,n))return!1}return!0}function cr(e,t){return e===`xmlns`?t===`http://www.w3.org/2000/svg`:e===`fill`?t===`currentColor`||t===`none`:e===`width`||e===`height`?/^\d+(\.\d+)?$/.test(t):e===`viewBox`?/^[\d.\-\s]+$/.test(t):e===`d`&&/^[AaCcHhLlMmQqSsTtVvZz0-9,.\-\s]+$/.test(t)}function lr(e){"use forget";let t=(0,Z.c)(9),{onView:n,title:r}=e,i=fe(),a;t[0]===i?a=t[1]:(a=i.formatMessage({id:`UPARFQ`,defaultMessage:`app`}),t[0]=i,t[1]=a);let o=r??a,s;t[2]===o?s=t[3]:(s=(0,$.jsx)(`span`,{children:(0,$.jsx)(F,{id:`chatgpt.app_block.history_created`,defaultMessage:`Created {appName}`,values:{appName:o}})}),t[2]=o,t[3]=s);let c;t[4]===n?c=t[5]:(c=n==null?null:(0,$.jsxs)($.Fragment,{children:[(0,$.jsx)(`span`,{"aria-hidden":`true`,children:(0,$.jsx)(F,{id:`chatgpt.app_block.history_separator`,defaultMessage:`•`})}),(0,$.jsx)(`button`,{className:`text-token-text-secondary hover:text-token-text-primary font-semibold transition-colors`,onClick:e=>{n(e.currentTarget)},type:`button`,children:(0,$.jsx)(F,{id:`chatgpt.app_block.history_view`,defaultMessage:`View`})})]}),t[4]=n,t[5]=c);let l;return t[6]!==s||t[7]!==c?(l=(0,$.jsxs)(`div`,{className:`text-token-text-tertiary my-3 flex w-fit items-center gap-1.5 text-sm`,children:[s,c]}),t[6]=s,t[7]=c,t[8]=l):l=t[8],l}function ur(e){"use forget";let t=(0,Z.c)(12),{className:n,onClick:r,ref:i}=e,a=fe(),o;t[0]===a?o=t[1]:(o=a.formatMessage({id:`I094Lq`,defaultMessage:`Open app`}),t[0]=a,t[1]=o);let s=o,c;t[2]===r?c=t[3]:(c=e=>{e.stopPropagation(),r()},t[2]=r,t[3]=c);let l;t[4]!==s||t[5]!==i||t[6]!==c?(l=(0,$.jsx)(A,{ref:i,type:`button`,icon:Le,color:`ghost`,size:`medium`,label:s,className:`size-9 rounded-full border-0 px-2 py-2 shadow-none`,onClick:c}),t[4]=s,t[5]=i,t[6]=c,t[7]=l):l=t[7];let u;return t[8]!==n||t[9]!==s||t[10]!==l?(u=(0,$.jsx)(ee,{label:s,className:n,children:l}),t[8]=n,t[9]=s,t[10]=l,t[11]=u):u=t[11],u}function dr(e){"use forget";let t=(0,Z.c)(190),{appBlockId:n,additionalResourceDomains:r,bind:a,clientThreadId:o,code:c,id:l,captureConsoleMessages:u,inlineHeight:d,isStreaming:f,onConsoleMessagesChange:p,onReadyChange:h,presentationSurface:_,previewLoadingLabel:v,progressiveStreaming:y,isSavedInlineLoad:b,ref:ee,styleMode:x,surface:S,title:w,variant:te,widgetRefSeenAtMs:ne}=e,E=f!==void 0&&f,D=y!==void 0&&y,re=b!==void 0&&b,ie=x===void 0?`default`:x,O=S===void 0?`inline`:S,k=te===void 0?`inline`:te,A=fe(),j=(0,Q.useRef)(null),M=(0,Q.useRef)(null),ae=Ue(a),[oe,ce]=(0,Q.useState)(ae.values),P=C(oe,ae.values)?oe:ae.values;P!==oe&&ce(P);let le=[...ae.callbacks.keys()],[I,ue]=(0,Q.useState)(le),L=C(I,le)?I:le;L!==I&&ue(L);let de=(0,Q.useRef)(P),pe=(0,Q.useRef)(L),me=(0,Q.useRef)(ae.callbacks),he=a!=null,ge=(0,Q.useRef)(!1),R=(0,Q.useRef)(!1),_e=(0,Q.useRef)(null),ve=(0,Q.useRef)(null),z=(0,Q.useRef)(null),ye=(0,Q.useRef)(null),be=(0,Q.useRef)(null),xe=(0,Q.useRef)(null),B=(0,Q.useRef)(null),V=(0,Q.useRef)(null),H=(0,Q.useRef)(0),U=(0,Q.useRef)(null),Se=(0,Q.useRef)(null),Ce;t[0]===Symbol.for(`react.memo_cache_sentinel`)?(Ce=[],t[0]=Ce):Ce=t[0];let we=(0,Q.useRef)(Ce),Te=g(),Ee=i(se),{isInternalPreview:De,networkPolicy:Oe}=(0,Q.useContext)(Ae),ke=Oe===void 0?`none`:Oe,je=Ye()||De,Me=qe(o)&&!De,Ne=Me||De&&ke===`deps-only`,W=Te?`dark`:`light`,Pe=A.locale,Fe;t[1]===Symbol.for(`react.memo_cache_sentinel`)?(Fe={status:`streaming`},t[1]=Fe):Fe=t[1];let[Ie,Le]=(0,Q.useState)(Fe),Re=Ie.status===`finalized`&&Ie.html!==c,ze=D&&!E&&(k===`artifact`||Ie.status===`failed`),G=D&&O===`inline`&&Ie.status!==`static`&&!ze&&!Re,Be=G&&E&&k===`artifact`&&!Jn(c),Ke=Be?0:_r,Je=d??`intrinsic-height`,Xe=je?`execution-enabled`:`execution-disabled`,Ze=Ne?`network-enabled`:`network-disabled`,Qe=De?`internal-preview`:`workspace-preview`,$e=he?`bindings-enabled`:`bindings-disabled`,et=G?`progressive-app-block-stream`:c,tt;t[2]===r?tt=t[3]:(tt=r??[],t[2]=r,t[3]=tt);let nt;t[4]!==Ee||t[5]!==Pe||t[6]!==ie||t[7]!==O||t[8]!==Je||t[9]!==Xe||t[10]!==Ze||t[11]!==Qe||t[12]!==$e||t[13]!==et||t[14]!==tt||t[15]!==W?(nt=[W,Ee,O,Je,ie,Pe,Xe,Ze,Qe,$e,et,...tt],t[4]=Ee,t[5]=Pe,t[6]=ie,t[7]=O,t[8]=Je,t[9]=Xe,t[10]=Ze,t[11]=Qe,t[12]=$e,t[13]=et,t[14]=tt,t[15]=W,t[16]=nt):nt=t[16];let rt=nt.join(`\0`),it;t[17]===r?it=t[18]:(it=tn(r),t[17]=r,t[18]=it);let at=it,ot=re?`saved_inline`:void 0,st=Ne?`deps_only`:`disabled`,ct=O===`inline`?k:void 0,lt=G?`progressive`:`static`,ut;t[19]!==O||t[20]!==ot||t[21]!==st||t[22]!==ct||t[23]!==lt?(ut={loadSource:ot,networkPolicy:st,surface:O,variant:ct,renderMode:lt},t[19]=O,t[20]=ot,t[21]=st,t[22]=ct,t[23]=lt,t[24]=ut):ut=t[24];let dt=ut,[ft,pt]=(0,Q.useState)(0),[mt,ht]=(0,Q.useState)(null),gt=mt?.signature===rt?mt.status:null,q=gt===`ready`,_t=q||gt===`failed_after_ready`,vt=G&&gt===`failed`,J=!E&&!G&&gt===`failed`,yt=_??O,bt=yt===`stage`||d!=null,xt=d==null?O:`stage`,Ct=D&&yt===`inline`&&k===`inline`,Tt=G&&yt===`inline`&&E&&!J,Et;t[25]!==c||t[26]!==dt||t[27]!==ne?(Et={content:c,metricTags:dt,widgetRefSeenAtMs:ne},t[25]=c,t[26]=dt,t[27]=ne,t[28]=Et):Et=t[28];let{cancelFirstPaintFrame:Ot,startRunMetrics:kt}=Dt(Et),At,jt;t[29]===q?(At=t[30],jt=t[31]):(At=()=>{q&&xe.current?.markFirstPaint()},jt=[q],t[29]=q,t[30]=At,t[31]=jt),m(At,jt);let Mt,Nt;t[32]!==q||t[33]!==h?(Mt=()=>{h?.(q)},Nt=[q,h],t[32]=q,t[33]=h,t[34]=Mt,t[35]=Nt):(Mt=t[34],Nt=t[35]),(0,Q.useEffect)(Mt,Nt);let Pt,Ft;t[36]!==L||t[37]!==P||t[38]!==ae.callbacks?(Pt=()=>{de.current=P,pe.current=L,me.current=ae.callbacks},Ft=[L,P,ae.callbacks],t[36]=L,t[37]=P,t[38]=ae.callbacks,t[39]=Pt,t[40]=Ft):(Pt=t[39],Ft=t[40]),m(Pt,Ft);let It;t[41]===Symbol.for(`react.memo_cache_sentinel`)?(It=e=>{M.current===e&&j.current?.updateAppBlockMessenger?.(Ge(e,de.current,pe.current))},t[41]=It):It=t[41];let Lt=N(It),Rt;t[42]===Lt?Rt=t[43]:(Rt=e=>{let t=M.current;if(t==null)return;let n=We(e,t),r=n&&me.current.get(n.name);if(n!=null&&r){let e=()=>{T.postTask(()=>Lt(t))};try{Promise.resolve(r(...n.args)).then(e,e)}catch{e()}}},t[42]=Lt,t[43]=Rt);let zt=N(Rt),Bt;t[44]!==he||t[45]!==q||t[46]!==Lt?(Bt=()=>{let e=M.current;!q||!he||e==null||Lt(e)},t[44]=he,t[45]=q,t[46]=Lt,t[47]=Bt):Bt=t[47];let Vt;t[48]!==L||t[49]!==P||t[50]!==he||t[51]!==q||t[52]!==Lt?(Vt=[L,P,he,q,Lt],t[48]=L,t[49]=P,t[50]=he,t[51]=q,t[52]=Lt,t[53]=Vt):Vt=t[53],(0,Q.useEffect)(Bt,Vt);let Ht,Ut;t[54]!==d||t[55]!==q||t[56]!==_?(Ht=()=>{!q||_==null||j.current?.updateAppBlockSurface?.(d==null?_:`stage`)},Ut=[d,q,_],t[54]=d,t[55]=q,t[56]=_,t[57]=Ht,t[58]=Ut):(Ht=t[57],Ut=t[58]),(0,Q.useEffect)(Ht,Ut);let Wt,Gt;t[59]===Symbol.for(`react.memo_cache_sentinel`)?(Wt=()=>({clearCapturedConsoleMessages:()=>{we.current=[]},captureScreenshotDataUrl:async()=>(await j.current?.screenshot())?.imageBase64??null,focus:()=>{j.current?.focus()}}),Gt=[],t[59]=Wt,t[60]=Gt):(Wt=t[59],Gt=t[60]),(0,Q.useImperativeHandle)(ee,Wt,Gt);let Kt;t[61]===Symbol.for(`react.memo_cache_sentinel`)?(Kt=()=>{U.current!=null&&(window.clearTimeout(U.current),U.current=null)},t[61]=Kt):Kt=t[61];let qt=N(Kt),Jt;t[62]===Symbol.for(`react.memo_cache_sentinel`)?(Jt=()=>{Se.current!=null&&(window.clearTimeout(Se.current),Se.current=null)},t[62]=Jt):Jt=t[62];let Y=N(Jt),Yt;t[63]!==q||t[64]!==G?(Yt=()=>{if(!G||!q||be.current==null)return;let e=ye.current,t=j.current;if(e==null||t?.updateAppBlockStream==null||R.current)return;let n=H.current;ye.current=null,ve.current=St(),z.current=e.html,e.isFinal&&(R.current=!0);let r=()=>H.current!==n||be.current==null?Promise.resolve():t.updateAppBlockStream?.(e)??Promise.resolve(),i=V.current,a=i==null?r():i.then(r);V.current=a,a.then(()=>{V.current===a&&(V.current=null);let t=be.current;H.current!==n||t==null||(Jn(e.html)&&t.markFirstPaint(),e.isFinal&&(t.reportPayloadSize(e.html),Le({status:`finalized`,html:e.html})))},e=>{V.current===a&&(V.current=null),H.current===n&&(e instanceof DOMException&&e.name===`AbortError`||B.current?.(`stream_update`,wt(e)))})},t[63]=q,t[64]=G,t[65]=Yt):Yt=t[65];let Xt=N(Yt),Zt;t[66]!==Ee||t[67]!==Ne||t[68]!==u||t[69]!==qt||t[70]!==Y||t[71]!==c||t[72]!==xt||t[73]!==he||t[74]!==je||t[75]!==Re||t[76]!==re||t[77]!==E||t[78]!==Pe||t[79]!==p||t[80]!==h||t[81]!==_||t[82]!==rt||t[83]!==Ie.status||t[84]!==ze||t[85]!==G||t[86]!==kt||t[87]!==ie||t[88]!==W?(Zt=()=>{if(!je)return;if(Ie.status===`failed`){if(E)return;Le({status:`static`}),pt(pr);return}(Re||ze&&Ie.status!==`static`)&&Le({status:`static`});let e=G&&j.current?.updateAppBlockStream!=null;if(G&&!e){E||Le({status:`static`});return}ge.current=!0,R.current=!1,_e.current=null,ve.current=null,z.current=null,ye.current=null,be.current=null,xe.current=null,B.current=null,V.current=null,Y(),H.current+=1;let t=H.current;qt(),ht(null),M.current=he?crypto.randomUUID():null;let{expectReadySignal:n,html:r,frameColorScheme:i}=nn(c,W,Pe,Ee,xt,{loadTailwind:Ne,progressiveStreaming:e,syncPresentationSurface:_!=null,styleMode:ie}),a=!1,o=!1,s=!1,l=!1,d=!1,f=()=>H.current===t,m=()=>e&&o,g=kt(f,{deferFirstPaint:e||re,deferPayloadSize:e});re&&(xe.current=g),e&&(be.current=g);let v=e=>{!u||p==null||!f()||(we.current=e,!l&&(l=!0,T.postTask(()=>{l=!1,f()&&p(we.current)},{priority:`background`})))},y=e=>{if(!(!f()||a||s)){if(a=!0,qt(),g.markReady(e),re){o=!0,ht({signature:rt,status:`ready`});return}d||(d=!0,T.postTask(()=>{d=!1,!(!f()||s)&&(o=!0,ht({signature:rt,status:`ready`}))},{priority:`background`}))}},b=(t,n)=>{!f()||s||(s=!0,qt(),Y(),ye.current=null,be.current=null,e&&Le({status:`failed`}),ht({signature:rt,status:m()?`failed_after_ready`:`failed`,readyTimedOut:n===`ready_timeout`}),g.reportFailure(t,n),T.postTask(()=>{f()&&(e?h?.(!1):h?.(!1,`failure`))},{priority:`background`}))};B.current=b,we.current=[],v([]),U.current=window.setTimeout(()=>{b(`sandbox_eval`,`ready_timeout`)},yr),(async()=>{let e=j.current?.evalAsync({code:r,...M.current==null?{}:{additionalGlobals:{__appBlockMessenger:Ge(M.current,de.current,pe.current)}},expectReadySignal:n,language:`html`,frameColorScheme:i,shouldPreservePreviewOnFatalError:()=>f()&&m()});if(e==null){b(`sandbox_eval`,`missing_generator`);return}for(;;){let t=await e.next();if(t.done){f()&&!a&&b(`sandbox_eval`,`generator_completed_without_ready`);break}f()&&(v([...we.current,t.value]),t.value.type===He.ENVIRONMENT_STATUS&&t.value.status===Ve.RUNNING_CODE&&y(`running_code`),t.value.type===He.RUN_COMPLETE&&(t.value.wasFatalError?b(`runtime`,`fatal_runtime_error`):(y(`run_complete`),g.reportSuccess(`run_complete`))),await T.yield())}})().catch(e=>{f()&&(e instanceof DOMException&&e.name===`AbortError`||b(`sandbox_eval`,wt(e)))})},t[66]=Ee,t[67]=Ne,t[68]=u,t[69]=qt,t[70]=Y,t[71]=c,t[72]=xt,t[73]=he,t[74]=je,t[75]=Re,t[76]=re,t[77]=E,t[78]=Pe,t[79]=p,t[80]=h,t[81]=_,t[82]=rt,t[83]=Ie.status,t[84]=ze,t[85]=G,t[86]=kt,t[87]=ie,t[88]=W,t[89]=Zt):Zt=t[89];let Qt=N(Zt),$t;t[90]!==qt||t[91]!==Y?($t=()=>{H.current+=1,ge.current=!1,R.current=!1,_e.current=null,z.current=null,ye.current=null,be.current=null,B.current=null,V.current=null,qt(),Y(),ht(null),pt(fr)},t[90]=qt,t[91]=Y,t[92]=$t):$t=t[92];let en=N($t),rn;t[93]!==bt||t[94]!==yt?(rn=yt===`inline`&&!bt?{margin:-4,width:`calc(100% + ${vr*2}px)`}:void 0,t[93]=bt,t[94]=yt,t[95]=rn):rn=t[95];let an=rn,on;t[96]!==Ot||t[97]!==qt||t[98]!==Y||t[99]!==Qt?(on=()=>{Qt();let e=j.current;return()=>{H.current+=1,M.current=null,be.current=null,xe.current=null,B.current=null,V.current=null,qt(),Y(),Ot(),e?.stop()}},t[96]=Ot,t[97]=qt,t[98]=Y,t[99]=Qt,t[100]=on):on=t[100];let sn;t[101]!==Ot||t[102]!==qt||t[103]!==Y||t[104]!==je||t[105]!==rt||t[106]!==Qt||t[107]!==ft?(sn=[Ot,qt,Y,je,rt,Qt,ft],t[101]=Ot,t[102]=qt,t[103]=Y,t[104]=je,t[105]=rt,t[106]=Qt,t[107]=ft,t[108]=sn):sn=t[108],(0,Q.useEffect)(on,sn);let cn,ln;t[109]!==E||t[110]!==Qt||t[111]!==G?(cn=()=>{!G||E||ge.current||j.current?.updateAppBlockStream!=null||Qt()},ln=[E,Qt,G],t[109]=E,t[110]=Qt,t[111]=G,t[112]=cn,t[113]=ln):(cn=t[112],ln=t[113]),(0,Q.useEffect)(cn,ln);let un,dn;if(t[114]!==Y||t[115]!==c||t[116]!==Xt||t[117]!==J||t[118]!==q||t[119]!==E||t[120]!==G||t[121]!==k?(un=()=>{if(!G||!q||J||R.current||j.current?.updateAppBlockStream==null)return;let e=E?qn(c):c;if(E&&(ye.current?.html??z.current)===e)return;if(ye.current={html:e,isFinal:!E},!E){Y(),Xt();return}let t=ve.current;if(t==null&&k===`artifact`&&(_e.current??=St(),t=_e.current),t==null){Xt();return}let n=k===`artifact`?xr:br,r=St()-t;if(r>=n){Xt();return}return Se.current=window.setTimeout(()=>{Se.current=null,Xt()},n-r),Y},dn=[Y,c,Xt,J,q,E,G,k],t[114]=Y,t[115]=c,t[116]=Xt,t[117]=J,t[118]=q,t[119]=E,t[120]=G,t[121]=k,t[122]=un,t[123]=dn):(un=t[122],dn=t[123]),(0,Q.useEffect)(un,dn),!je){let e;return t[124]===Symbol.for(`react.memo_cache_sentinel`)?(e=(0,$.jsx)(Dn,{}),t[124]=e):e=t[124],e}let fn=Ct&&`flex-col`,pn=yt===`inline`&&(Be?`h-0 min-h-0 overflow-hidden`:`min-h-[120px] overflow-visible`),mn=yt===`stage`&&`h-full min-h-0`,hn;t[125]!==fn||t[126]!==pn||t[127]!==mn?(hn=s(`flex w-full`,fn,pn,mn),t[125]=fn,t[126]=pn,t[127]=mn,t[128]=hn):hn=t[128];let gn;t[129]!==Ct||t[130]!==Tt||t[131]!==w?(gn=Ct?(0,$.jsx)(Ln,{isVisible:Tt,title:w}):null,t[129]=Ct,t[130]=Tt,t[131]=w,t[132]=gn):gn=t[132];let _n=!E&&!G&&(gt===`failed`||gt===`failed_after_ready`)&&mt?.readyTimedOut||void 0,vn=yt===`inline`&&!bt?`flex-none`:`w-full`,yn=Tt&&`mask-shimmer mask-shimmer-duration-2800 motion-reduce:animate-none`,bn;t[133]!==vn||t[134]!==yn?(bn=s(`relative min-w-0`,vn,yn),t[133]=vn,t[134]=yn,t[135]=bn):bn=t[135];let xn;t[136]!==d||t[137]!==an||t[138]!==yt?(xn=yt===`inline`&&d!=null?{height:d}:an,t[136]=d,t[137]=an,t[138]=yt,t[139]=xn):xn=t[139];let Sn=`${ft}:${Ne?`network-enabled`:`network-disabled`}:${De?`internal-preview`:`workspace-preview`}`,Cn;t[140]!==n||t[141]!==o||t[142]!==l?(Cn=JSON.stringify([o??null,n??l]),t[140]=n,t[141]=o,t[142]=l,t[143]=Cn):Cn=t[143];let wn;t[144]===A?wn=t[145]:(wn=A.formatMessage({id:`gxcrdR`,defaultMessage:`App block preview`}),t[144]=A,t[145]=wn);let Tn=Ne?`deps-only`:`none`,En=Me?Sr:Cr,On=_t?0:-1,kn=he?zt:void 0,An=yt===`inline`&&!bt,jn=!bt,Mn=G?Ke:gr,Nn;t[146]!==l||t[147]!==De||t[148]!==Qt||t[149]!==at||t[150]!==Sn||t[151]!==Cn||t[152]!==wn||t[153]!==Tn||t[154]!==En||t[155]!==On||t[156]!==kn||t[157]!==An||t[158]!==jn||t[159]!==Mn?(Nn=(0,$.jsx)(K,{id:l,sandboxOriginId:Cn,title:wn,visuallyHidden:!1,networkPolicy:Tn,disableExternalNavigation:De,additionalResourceDomains:at,sandboxPermissions:En,disablePermissions:!0,enableTransition:!1,enableAnimation:!1,iframeTabIndex:On,onRetryCodeRun:Qt,onAppBlockMessage:kn,transparentBackground:An,useIntrinsicHeight:jn,intrinsicHeightFallback:Mn,ref:j},Sn),t[146]=l,t[147]=De,t[148]=Qt,t[149]=at,t[150]=Sn,t[151]=Cn,t[152]=wn,t[153]=Tn,t[154]=En,t[155]=On,t[156]=kn,t[157]=An,t[158]=jn,t[159]=Mn,t[160]=Nn):Nn=t[160];let Pn;t[161]===Tt?Pn=t[162]:(Pn=Tt?(0,$.jsx)(`div`,{"aria-hidden":`true`,className:`absolute inset-0 z-10 cursor-wait`}):null,t[161]=Tt,t[162]=Pn);let Fn;t[163]!==vt||t[164]!==J||t[165]!==_t||t[166]!==v||t[167]!==G?(Fn=!_t&&!J&&(!G||vt)?(0,$.jsx)(mr,{label:v}):null,t[163]=vt,t[164]=J,t[165]=_t,t[166]=v,t[167]=G,t[168]=Fn):Fn=t[168];let In;t[169]!==J||t[170]!==en?(In=J?(0,$.jsx)(hr,{onRetry:en}):null,t[169]=J,t[170]=en,t[171]=In):In=t[171];let X;t[172]!==Tt||t[173]!==_n||t[174]!==bn||t[175]!==xn||t[176]!==Nn||t[177]!==Pn||t[178]!==Fn||t[179]!==In?(X=(0,$.jsxs)(`div`,{"aria-busy":Tt,"data-app-block-ready-timeout":_n,className:bn,style:xn,children:[Nn,Pn,Fn,In]}),t[172]=Tt,t[173]=_n,t[174]=bn,t[175]=xn,t[176]=Nn,t[177]=Pn,t[178]=Fn,t[179]=In,t[180]=X):X=t[180];let Rn;t[181]!==v||t[182]!==Tt||t[183]!==k?(Rn=Tt&&k===`artifact`?(0,$.jsx)(`span`,{"aria-atomic":`true`,"aria-live":`polite`,className:`sr-only`,role:`status`,children:v??(0,$.jsx)(F,{id:`chatgpt.app_block.preview_loading`,defaultMessage:`Loading app`})}):null,t[181]=v,t[182]=Tt,t[183]=k,t[184]=Rn):Rn=t[184];let zn;return t[185]!==hn||t[186]!==gn||t[187]!==X||t[188]!==Rn?(zn=(0,$.jsxs)(`div`,{className:hn,children:[gn,X,Rn]}),t[185]=hn,t[186]=gn,t[187]=X,t[188]=Rn,t[189]=zn):zn=t[189],zn}function fr(e){return e+1}function pr(e){return e+1}function mr(e){"use forget";let t=(0,Z.c)(5),{label:n}=e,r;t[0]===Symbol.for(`react.memo_cache_sentinel`)?(r=(0,$.jsx)(a,{className:`icon-sm text-token-text-tertiary`}),t[0]=r):r=t[0];let i;t[1]===n?i=t[2]:(i=n??(0,$.jsx)(F,{id:`chatgpt.app_block.preview_loading`,defaultMessage:`Loading app`}),t[1]=n,t[2]=i);let o;return t[3]===i?o=t[4]:(o=(0,$.jsxs)(`div`,{"aria-live":`polite`,className:`bg-primary absolute inset-0 z-10 flex cursor-wait items-center justify-center gap-2 text-sm`,role:`status`,children:[r,(0,$.jsx)(`span`,{className:`text-token-text-secondary`,children:i})]}),t[3]=i,t[4]=o),o}function hr(e){"use forget";let t=(0,Z.c)(4),{onRetry:n}=e,r;t[0]===Symbol.for(`react.memo_cache_sentinel`)?(r=(0,$.jsx)(`p`,{className:`text-token-text-secondary text-sm`,children:(0,$.jsx)(F,{id:`chatgpt.app_block.preview_load_failed`,defaultMessage:`This app couldn't load.`})}),t[0]=r):r=t[0];let i;t[1]===Symbol.for(`react.memo_cache_sentinel`)?(i=(0,$.jsx)(F,{id:`chatgpt.app_block.preview_retry`,defaultMessage:`Try again`}),t[1]=i):i=t[1];let a;return t[2]===n?a=t[3]:(a=(0,$.jsxs)(`div`,{className:`bg-primary absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 px-6 text-center`,role:`alert`,children:[r,(0,$.jsx)(A,{type:`button`,color:`secondary`,size:`small`,onClick:n,children:i})]}),t[2]=n,t[3]=a),a}var Z,Q,$,gr,_r,vr,yr,br,xr,Sr,Cr,wr,Tr,Er,Dr,Or,kr,Ar,jr,Mr,Nr,Pr=e((()=>{Z=de(),d(),Ze(),V(),ke(),D(),w(),Xe(),y(),G(),ze(),Be(),_e(),Je(),E(),B(),dt(),lt(),be(),h(),re(),O(),we(),r(),oe(),l(),x(),$e(),ft(),z(),Ke(),f(),ae(),Q=n(I()),le(),pn(),Lt(),bt(),En(),xe(),An(),_n(),Rn(),rt(),Ce(),U(),it(),Gn(),$=ce(),gr=432,_r=120,vr=4,yr=15e3,br=100,xr=350,Sr=`allow-scripts allow-same-origin allow-forms`,Cr=`allow-scripts allow-same-origin`,wr=12e3,Tr=/<\/?([a-zA-Z][\w:-]*)(\s[^<>]*)?>/g,Er=/([a-zA-Z_:][\w:.-]*)\s*=\s*"([^"]*)"/g,Dr=new Set([`svg`,`path`]),Or=new Set([`d`,`fill`,`height`,`viewBox`,`width`,`xmlns`]),kr=/<script(?:\s|>)/i,Ar=`script, style, template, link, meta, title, [hidden], [style*="display:none" i], [style*="visibility:hidden" i]`,jr=`audio, br, button, canvas, embed, hr, iframe, img, input, meter, object, picture, progress, select, svg, table, textarea, video`,Mr=e=>{"use forget";let t=(0,Z.c)(13),{canOpen:n,conversation:r,expandButtonRef:i,isReady:a,onOpen:o,target:s}=e,c;t[0]!==n||t[1]!==i||t[2]!==o?(c=n&&o!=null?(0,$.jsx)(ur,{ref:i,className:`shrink-0`,onClick:o}):null,t[0]=n,t[1]=i,t[2]=o,t[3]=c):c=t[3];let l=c;if(r==null)return l;let u;t[4]===s?u=t[5]:(u=s??{contentReferenceIndex:-1,messageId:``},t[4]=s,t[5]=u);let d=u,f=a&&s!=null,p;t[6]===l?p=t[7]:(p=e=>{let{isVisible:t,label:n,onSelect:r}=e;return t?(0,$.jsxs)(`div`,{className:`flex shrink-0 items-center gap-1`,children:[(0,$.jsx)(ee,{label:n,children:(0,$.jsx)(A,{type:`button`,icon:Ie,color:`ghost`,size:`medium`,label:n,className:`size-9 rounded-full border-0 px-2 py-2 shadow-none`,onClick:e=>{e.stopPropagation(),r()}})}),l]}):l},t[6]=l,t[7]=p);let m;return t[8]!==d||t[9]!==r||t[10]!==f||t[11]!==p?(m=(0,$.jsx)(pt,{category:H.AppBlock,conversation:r,isReady:f,target:d,children:p}),t[8]=d,t[9]=r,t[10]=f,t[11]=p,t[12]=m):m=t[12],m},Nr=e=>{"use forget";let t=(0,Z.c)(9),{children:n,conversation:r,isReady:i,target:a}=e;if(r==null)return n;let o;t[0]===a?o=t[1]:(o=a??{contentReferenceIndex:-1,messageId:``},t[0]=a,t[1]=o);let s=o,c=i&&a!=null,l;t[2]===n?l=t[3]:(l=e=>(0,$.jsxs)(`div`,{className:`group/keyboard-or-hover relative`,children:[n,e.isVisible?(0,$.jsx)(`div`,{className:`pointer-events-none absolute end-2 top-2 z-10`,children:(0,$.jsx)(`div`,{className:`cant-hover:hidden`,children:(0,$.jsx)(mt,{action:e})})}):null]}),t[2]=n,t[3]=l);let u;return t[4]!==s||t[5]!==r||t[6]!==c||t[7]!==l?(u=(0,$.jsx)(pt,{category:H.InlineAppBlock,conversation:r,isReady:c,target:s,children:l}),t[4]=s,t[5]=r,t[6]=c,t[7]=l,t[8]=u):u=t[8],u}}));export{Kn as a,Gn as c,En as d,St as f,J as g,yt as h,dr as i,xn as l,bt as m,rr as n,Pr as o,Lt as p,mr as r,zn as s,Yn as t,Sn as u};
//# sourceMappingURL=e3b746a6-i992enln6qoeq08g.js.map