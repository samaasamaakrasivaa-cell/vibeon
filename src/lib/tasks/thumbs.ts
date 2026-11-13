// @ts-nocheck
// Схематичные картинки типов заданий для каталога — перенесены из прототипа lesson-builder.js без изменений.
const B='fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"';
const ln=(x,y,w)=>`<line x1="${x}" y1="${y}" x2="${x+w}" y2="${y}" ${B} opacity=".45"/>`;
const bx=(x,y,w,h,f)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" ${f?'fill="currentColor" opacity=".25"':B}/>`;
const THUMB={
 image:bx(14,6,52,30)+`<path d="M18 32l12-12 9 8 7-6 16 10" ${B}/><circle cx="54" cy="14" r="3" ${B}/>`,
 video:bx(14,6,52,30)+`<path d="M35 14l12 7-12 7z" fill="currentColor" opacity=".7"/>`,
 audio:`${[0,1,2,3,4,5,6,7,8].map(i=>`<line x1="${16+i*6}" y1="${21-[4,9,6,12,8,11,5,9,4][i]}" x2="${16+i*6}" y2="${21+[4,9,6,12,8,11,5,9,4][i]}" ${B}/>`).join("")}`,
 text:ln(12,10,56)+ln(12,17,50)+ln(12,24,56)+ln(12,31,38),
 wordset:[8,18,28].map(y=>`<path d="M12 ${y-2}h3l3-3v10l-3-3h-3z" fill="currentColor" opacity=".55"/>`+ln(24,y,22)+ln(50,y,16)).join(""),
 info:`<rect x="8" y="6" width="64" height="30" rx="6" fill="currentColor" opacity=".12"/>`+ln(16,15,48)+ln(16,22,40)+ln(16,29,26),
 note:bx(10,6,60,30,1)+ln(16,15,40)+ln(16,23,30),
 link:`<rect x="20" y="14" width="40" height="14" rx="7" fill="currentColor" opacity=".55"/>`,
 divider:`<path d="M10 21l6-5 6 5 6-5 6 5 6-5 6 5 6-5 6 5 6-5" ${B}/>`,
 gap:ln(8,22,16)+bx(26,15,16,12)+ln(44,22,24),
 drag:bx(10,5,14,8,1)+bx(28,5,14,8,1)+bx(46,5,14,8,1)+ln(8,28,12)+bx(22,22,16,11)+ln(40,28,14),
 dropdown:ln(8,22,14)+bx(24,15,28,13)+`<path d="M44 20l3 3 3-3" ${B}/>`+ln(54,22,14),
 test:[9,20,31].map((y,i)=>bx(14,y-4,8,8,i===1)+ln(26,y,30)).join(""),
 tf:ln(16,10,48)+`<rect x="18" y="20" width="18" height="11" rx="5" fill="currentColor" opacity=".55"/><rect x="42" y="20" width="18" height="11" rx="5" ${B}/>`,
 pairs:bx(10,6,20,9)+bx(10,22,20,9)+bx(50,6,20,9)+bx(50,22,20,9)+`<path d="M30 10l20 16M30 26l20-16" ${B}/>`,
 columns:bx(10,4,12,7,1)+bx(26,4,12,7,1)+bx(42,4,12,7,1)+bx(10,16,28,22)+bx(42,16,28,22),
 picture:bx(10,4,16,16,1)+bx(32,4,16,16,1)+bx(54,4,16,16,1)+bx(10,24,16,8)+bx(32,24,16,8)+bx(54,24,16,8),
 sentence:bx(8,8,14,9,1)+bx(25,8,10,9,1)+bx(38,8,16,9,1)+bx(57,8,14,9,1)+ln(8,30,64),
 textorder:[6,17,28].map(y=>bx(18,y,48,8)+`<path d="M11 ${y+2}l2-2 2 2M11 ${y+6}l2 2 2-2" ${B}/>`).join(""),
 letters:[0,1,2,3,4].map(i=>bx(14+i*11,8,9,10)).join("")+[0,1,2,3,4].map(i=>bx(14+i*11,26,9,9,1)).join(""),
 essay:bx(10,4,60,34)+ln(16,12,46)+ln(16,19,46)+ln(16,26,30),
 open:ln(10,9,40)+bx(10,16,60,18),
 record:`<rect x="34" y="4" width="12" height="20" rx="6" ${B}/><path d="M28 18a12 12 0 0 0 24 0M40 30v6" ${B}/>`,
 speak:`<rect x="8" y="5" width="34" height="16" rx="6" ${B}/><rect x="38" y="20" width="34" height="16" rx="6" fill="currentColor" opacity=".3"/>`,
 errors:ln(8,20,14)+`<line x1="26" y1="20" x2="44" y2="20" stroke="currentColor" stroke-width="1.6" opacity=".45"/><path d="M26 25q2.5 3 5 0t5 0 4 0 4 0" stroke="#FF3B30" fill="none" stroke-width="1.5"/>`+ln(48,20,22),
 transform:ln(8,13,30)+`<path d="M42 21h14M51 16l5 5-5 5" ${B}/>`+ln(8,30,64),
 translate:`<text x="10" y="26" font-size="13" fill="currentColor" opacity=".6">Аа</text><path d="M32 21h14M41 16l5 5-5 5" ${B}/><text x="52" y="26" font-size="13" fill="currentColor" opacity=".6">Aa</text>`,
 mark:ln(8,12,64)+`<rect x="24" y="20" width="18" height="9" rx="2" fill="#FFCC00" opacity=".6"/>`+ln(8,24,14)+ln(46,24,24)+ln(8,34,40),
 dictation:`<path d="M10 10h4l5-4v14l-5-4h-4z" fill="currentColor" opacity=".55"/>`+ln(26,13,44)+ln(10,30,60),
 crossword:[[20,6],[30,6],[40,6],[50,6],[30,16],[30,26],[40,26],[50,26]].map(([x,y])=>bx(x,y,10,10)).join("")
};
const GAP_SVG='<rect x="6" y="9" width="20" height="4" rx="2" fill="#C7CEDB"/><rect x="30" y="6" width="24" height="10" rx="5" fill="#0A84FF" opacity=".18"/><rect x="30" y="6" width="24" height="10" rx="5" fill="none" stroke="#0A84FF" stroke-width="1.6"/><path d="M42 8.5v5" stroke="#0A84FF" stroke-width="1.6" stroke-linecap="round"/><rect x="58" y="9" width="16" height="4" rx="2" fill="#C7CEDB"/><rect x="6" y="25" width="30" height="4" rx="2" fill="#C7CEDB"/><rect x="40" y="22" width="20" height="10" rx="5" fill="#34C759" opacity=".2"/><rect x="40" y="22" width="20" height="10" rx="5" fill="none" stroke="#34C759" stroke-width="1.6"/><rect x="64" y="25" width="10" height="4" rx="2" fill="#C7CEDB"/>';
const thumb=k=>`<svg class="thumb" viewBox="0 0 80 42" aria-hidden="true">${(k==="gap"||k==="drag")?GAP_SVG:k==="wordset"?'<rect x="22" y="5" width="36" height="24" rx="5" fill="#E8F0FF" stroke="#9DBBFA" stroke-width="1.4" transform="rotate(-8 40 17)"/><rect x="22" y="9" width="36" height="26" rx="5" fill="#FFFFFF" stroke="#0A84FF" stroke-width="1.6"/><text x="40" y="22" text-anchor="middle" font-size="9" font-weight="700" fill="#0A84FF" font-family="-apple-system,Segoe UI,Arial">Aa</text><rect x="30" y="26" width="20" height="2.6" rx="1.3" fill="#C7CEDB"/>':(THUMB[k]||"")}</svg>`;
export const thumbSvg = (k: string) => thumb(k);
