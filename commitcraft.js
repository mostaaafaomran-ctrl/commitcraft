(function(root){
function parse(diff){
  const files=[];let cur=null;
  diff.split(/\r?\n/).forEach(l=>{
    let m=l.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if(m){cur={path:m[2],add:0,del:0,isNew:false,isDel:false,renamed:m[1]!==m[2],from:m[1],added:[],removed:[]};files.push(cur);return}
    if(!cur)return;
    if(/^new file mode/.test(l))cur.isNew=true;
    else if(/^deleted file mode/.test(l))cur.isDel=true;
    else if(l.startsWith('+++')||l.startsWith('---'))return;
    else if(l[0]==='+'){cur.add++;cur.added.push(l.slice(1))}
    else if(l[0]==='-'){cur.del++;cur.removed.push(l.slice(1))}
  });
  return files;
}
function kind(p){
  const f=p.toLowerCase();
  if(/(^|\/)(readme|changelog|license|docs?\/)/.test(f)||/\.(md|mdx|rst|txt)$/.test(f))return'docs';
  if(/(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$|_test\.(go|py)$/.test(f))return'test';
  if(/^\.github\/|(^|\/)(\.gitlab-ci|jenkinsfile|azure-pipelines)|\.circleci\//.test(f))return'ci';
  if(/(^|\/)(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|requirements\.txt|pyproject\.toml|go\.(mod|sum)|cargo\.(toml|lock)|dockerfile|docker-compose\.ya?ml|\.gitignore|\.eslintrc.*|\.prettierrc.*|tsconfig\.json|vite\.config\.[a-z]+|webpack\.config\.[a-z]+)$/.test(f))return'chore';
  if(/\.(css|scss|sass|less)$/.test(f))return'style';
  return'code';
}
const FIXRE=/\b(fix|bug|error|crash|null|undefined|typo|wrong|broken|fail|issue|patch|guard)\b/i;
function scopeOf(files){
  const dirs=files.map(f=>f.path.split('/')).filter(a=>a.length>1).map(a=>a[0]==='src'&&a.length>2?a[1]:a[0]);
  if(!dirs.length||dirs.length<files.length*0.6)return'';
  const c={};dirs.forEach(d=>c[d]=(c[d]||0)+1);
  const top=Object.entries(c).sort((a,b)=>b[1]-a[1])[0];
  if(top[1]<dirs.length*0.8)return'';
  if(['src','lib','app','.github'].includes(top[0]))return top[0]==='.github'?'ci':'';
  return top[0].replace(/[^a-z0-9-_]/gi,'').toLowerCase();
}
function names(files){
  const out=[];
  files.forEach(f=>{
    const b=f.path.split('/').pop().replace(/\.[^.]+$/,'');
    if(b&&!out.includes(b))out.push(b);
  });
  return out;
}
function symbols(files){
  const out=[];
  files.forEach(f=>f.added.forEach(l=>{
    let m=l.match(/^\s*(?:export\s+)?(?:async\s+)?(?:function\*?|def|func|fn)\s+([A-Za-z_]\w*)/)||l.match(/^\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_]\w*)\s*=>/)||l.match(/^\s*(?:export\s+)?class\s+([A-Za-z_]\w*)/);
    if(m&&!out.includes(m[1]))out.push(m[1]);
  }));
  return out;
}
function words(n){return n.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ').toLowerCase()}
function suggest(diff){
  const files=parse(diff);
  if(!files.length)return null;
  const kinds=files.map(f=>kind(f.path));
  const uniq=[...new Set(kinds)];
  let type;
  if(uniq.length===1&&uniq[0]!=='code')type=uniq[0];
  else if(uniq.filter(k=>k!=='docs'&&k!=='test').length===0)type=uniq.includes('test')?'test':'docs';
  else{
    const code=files.filter((f,i)=>kinds[i]==='code'||kinds[i]==='style');
    const adds=code.reduce((a,f)=>a+f.add,0),dels=code.reduce((a,f)=>a+f.del,0);
    const txt=code.map(f=>f.added.concat(f.removed).join('\n')).join('\n');
    const newFiles=code.filter(f=>f.isNew).length;
    if(newFiles&&newFiles>=code.length/2)type='feat';
    else if(dels>adds*1.5&&dels>10)type='refactor';
    else if(FIXRE.test(txt)&&adds+dels<60)type='fix';
    else if(adds>dels*2)type='feat';
    else type='refactor';
  }
  const scope=scopeOf(files);
  const syms=symbols(files),ns=names(files);
  const adds=files.reduce((a,f)=>a+f.add,0),dels=files.reduce((a,f)=>a+f.del,0);
  let subject;
  const first=files[0];
  const target=syms.length?words(syms[0]):ns.length?words(ns[0]):'project';
  const extra=files.length>1?(syms.length>1?' and '+words(syms[1]):' and related files'):'';
  const verbs={feat:'add',fix:'fix',docs:'update',test:'add tests for',style:'update styles for',refactor:'refactor',chore:'update',ci:'update'};
  let v=verbs[type];
  if(type==='docs')subject='update '+(ns.length?words(ns[0]):'docs')+(files.length>1?' and other docs':'');
  else if(type==='chore'&&files.some(f=>/package/.test(f.path)))subject='update dependencies and package config';
  else if(type==='chore')subject='update '+words(ns[0]||'config')+(files.length>1?' and config':'');
  else if(type==='ci')subject='update '+words(ns[0]||'workflow')+' workflow';
  else if(type==='feat'&&first.isNew&&files.length===1)subject='add '+target;
  else if(type==='test')subject='add tests for '+target;
  else subject=v+' '+target+extra;
  subject=subject.replace(/\s+/g,' ').trim().slice(0,60);
  const body=files.slice(0,8).map(f=>'- '+(f.isNew?'add ':f.isDel?'remove ':f.renamed?'rename '+f.from+' to ':'update ')+f.path+' (+'+f.add+' -'+f.del+')');
  if(files.length>8)body.push('- and '+(files.length-8)+' more files');
  const breaking=/BREAKING CHANGE/i.test(diff);
  return{type,scope,subject,body,files,adds,dels,breaking};
}
function format(o){
  const head=o.type+(o.scope?'('+o.scope+')':'')+(o.breaking?'!':'')+': '+o.subject;
  return o.withBody&&o.body.length?head+'\n\n'+o.body.join('\n'):head;
}
const api={parse,kind,suggest,format};
if(typeof module!=='undefined')module.exports=api;else root.CommitCraft=api;
})(this);
