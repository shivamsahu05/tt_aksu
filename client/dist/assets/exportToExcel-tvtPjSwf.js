const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/sweetalert2.all-52egNBBD.js","assets/rolldown-runtime-aKtaBQYM.js"])))=>i.map(i=>d[i]);
import{i as e}from"./rolldown-runtime-aKtaBQYM.js";import{u as t}from"./index-BGpPXDOt.js";import{n,t as r}from"./xlsx-DXM_A2ny.js";var i={headerBg:`4F46E5`,headerFg:`FFFFFF`,evenRowBg:`F0F0FF`,oddRowBg:`FFFFFF`,borderColor:`D1D5DB`,notesBg:`FEF9C3`,notesFg:`713F12`,titleBg:`1E1B4B`,titleFg:`FFFFFF`},a=({bgColor:e=`FFFFFF`,fontColor:t=`000000`,bold:n=!1,italic:r=!1,size:a=10,wrapText:o=!1,halign:s=`left`}={})=>({font:{name:`Calibri`,sz:a,bold:n,italic:r,color:{rgb:t}},fill:{fgColor:{rgb:e},patternType:`solid`},border:{top:{style:`thin`,color:{rgb:i.borderColor}},bottom:{style:`thin`,color:{rgb:i.borderColor}},left:{style:`thin`,color:{rgb:i.borderColor}},right:{style:`thin`,color:{rgb:i.borderColor}}},alignment:{horizontal:s,vertical:`center`,wrapText:o}}),o=async({filename:o,sheetName:s=`Data`,columns:c,data:l,notes:u=[]})=>{let d=(await t(async()=>{let{default:t}=await import(`./sweetalert2.all-52egNBBD.js`).then(t=>e(t.t(),1));return{default:t}},__vite__mapDeps([0,1]))).default,f=u.filter(e=>e.startsWith(`✅`)),p=u.filter(e=>e.startsWith(`❌`)),m=u.filter(e=>!e.startsWith(`✅`)&&!e.startsWith(`❌`)),h=`
        <div style="text-align:left;font-size:13px;line-height:1.7;">
            <div style="font-weight:700;font-size:14px;color:#1e1b4b;margin-bottom:10px;">
                📊 Export Preview — <span style="color:#4f46e5">${o}</span>
            </div>
            <div style="background:#f0f0ff;border:1px solid #c7d2fe;border-radius:8px;padding:12px;margin-bottom:10px;">
                <div style="font-weight:600;color:#4f46e5;margin-bottom:6px;">📋 Details</div>
                <div>Sheet: <strong>${s}</strong></div>
                <div>Total Records: <strong>${l.length}</strong></div>
                <div>Columns: <strong>${c.length}</strong></div>
            </div>
            ${f.length>0?`
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px;margin-bottom:8px;">
                <div style="font-weight:600;color:#15803d;margin-bottom:4px;">Included in Export</div>
                ${f.map(e=>`<div style="color:#166534;font-size:12px;">${e}</div>`).join(``)}
            </div>`:``}
            ${p.length>0?`
            <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px;margin-bottom:8px;">
                <div style="font-weight:600;color:#dc2626;margin-bottom:4px;">Not Included</div>
                ${p.map(e=>`<div style="color:#991b1b;font-size:12px;">${e}</div>`).join(``)}
            </div>`:``}
            ${m.length>0?`
            <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px;">
                ${m.map(e=>`<div style="color:#92400e;font-size:12px;">${e}</div>`).join(``)}
            </div>`:``}
        </div>
    `;if(!(await d.fire({title:`Export to Excel`,html:h,icon:`info`,showCancelButton:!0,confirmButtonColor:`#4f46e5`,cancelButtonColor:`#6b7280`,confirmButtonText:`<i class="bi bi-file-earmark-excel me-2"></i>Download Excel`,cancelButtonText:`Cancel`,width:500})).isConfirmed)return;let g={},_=s.substring(0,31),v=c.length,y=r.encode_cell({r:0,c:0});g[y]={v:`${o} — Exported on ${new Date().toLocaleString(`en-IN`,{dateStyle:`long`,timeStyle:`short`})}`,t:`s`,s:a({bgColor:i.titleBg,fontColor:i.titleFg,bold:!0,size:11,halign:`left`})},g[`!merges`]||=[],g[`!merges`].push({s:{r:0,c:0},e:{r:0,c:v-1}});let b=2;if(u.length>0){let e=r.encode_cell({r:1,c:0});g[e]={v:u.join(`  |  `),t:`s`,s:a({bgColor:i.notesBg,fontColor:i.notesFg,italic:!0,size:9,wrapText:!1,halign:`left`})},g[`!merges`].push({s:{r:1,c:0},e:{r:1,c:v-1}}),b=2}else b=1;let x=b;c.forEach((e,t)=>{let n=r.encode_cell({r:x,c:t});g[n]={v:e.header,t:`s`,s:a({bgColor:i.headerBg,fontColor:i.headerFg,bold:!0,size:10,halign:`center`})}}),l.forEach((e,t)=>{let n=x+1+t,o=t%2==0?i.evenRowBg:i.oddRowBg;c.forEach((t,i)=>{let s=r.encode_cell({r:n,c:i}),c=typeof t.key==`function`?t.key(e):e[t.key]??``;c??=``;let l=t.type===`number`||typeof c==`number`;g[s]={v:c,t:l?`n`:`s`,s:a({bgColor:o,size:10,wrapText:!1})}})});let S=x+l.length;g[`!ref`]=r.encode_range({s:{r:0,c:0},e:{r:S,c:v-1}}),g[`!cols`]=c.map((e,t)=>{let n=e.header.length,r=l.reduce((t,n)=>{let r=typeof e.key==`function`?e.key(n):n[e.key]??``;return Math.max(t,String(r).length)},0);return{wch:Math.min(Math.max(n,r,10)+4,50)}}),g[`!rows`]=[{hpt:22},...u.length>0?[{hpt:16}]:[],{hpt:20},...l.map(()=>({hpt:18}))];let C=r.book_new();r.book_append_sheet(C,g,_);let w=o.replace(/[/\\?%*:|"<>]/g,`_`);n(C,`${w}_${new Date().toISOString().split(`T`)[0]}.xlsx`),d.fire({title:`Downloaded!`,text:`${w}.xlsx has been saved to your downloads folder.`,icon:`success`,timer:2500,showConfirmButton:!1,toast:!0,position:`top-end`})};export{o as t};