(() => {
  'use strict';
  const $ = id => document.getElementById(id), config = window.FRUIT_BACKEND || {};
  const configured = /^https:\/\/[a-z0-9.-]+\.supabase\.co$/.test(config.url || '') && !!config.publishableKey;
  const SESSION_KEY = 'wangge-admin-session';
  let session = null, links = [], cursor = null, loaded = 0, queryVersion = 0, refreshing = null;
  const PAGE_SIZE = 100;
  const message = text => { $('status').textContent = text; };
  const displayTime = value => new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value));
  function storeSession(value) {
    session = value;
    try { if(value) localStorage.setItem(SESSION_KEY, JSON.stringify(value)); else localStorage.removeItem(SESSION_KEY); } catch (_) {}
  }
  async function responseJSON(response) {
    const body = await response.json().catch(() => null);
    if (!response.ok) { const error = new Error(response.status===401 || response.status===403 ? '登录已失效，请重新登录。' : response.status===429 ? '请求较多，请稍后重试。' : '请求未成功，请检查网络或数据库配置。'); error.status=response.status; throw error; }
    return body;
  }
  async function validToken() {
    if (!session) throw new Error('请先登录。');
    if (session.expires_at > Date.now()/1000 + 60) return session.access_token;
    if (!refreshing) refreshing = (async () => {
      const response = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {method:'POST',headers:{apikey:config.publishableKey,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token})});
      const next = await responseJSON(response);
      storeSession({...next,expires_at:Math.floor(Date.now()/1000)+next.expires_in});
    })().finally(() => { refreshing=null; });
    await refreshing; return session.access_token;
  }
  async function api(path, options={}) {
    const token = await validToken();
    const response = await fetch(`${config.url}${path}`,{...options,headers:{apikey:config.publishableKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json',...options.headers}});
    return responseJSON(response);
  }
  function fail(error) { message(error.message); if(error.status===401 || error.status===403){storeSession(null);showLogin();} }
  function showLogin() { $('dashboard').hidden=true;$('login').hidden=false; }
  function td(value) { const el=document.createElement('td');el.textContent=value;return el; }
  function shareURL(token) { const url=new URL('./',location.href);url.hash=new URLSearchParams({share:token}).toString();return url.href; }
  async function loadLinks() {
    links=await api('/rest/v1/share_links?select=id,label,share_token,created_at&order=created_at.desc');
    const previous=$('filter').value;$('links').replaceChildren();$('filter').replaceChildren(new Option('所有人',''));
    for(const link of links){
      const row=document.createElement('div');row.className='link-item';
      const label=document.createElement('span');label.className='link-name';label.textContent=link.label;
      const button=document.createElement('button');button.className='secondary';button.textContent='复制专属链接';
      button.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(shareURL(link.share_token));message('专属链接已复制，发给对方即可。');}catch(_){message(`请复制这个专属链接：${shareURL(link.share_token)}`);}});
      row.append(label,button);$('links').append(row);$('filter').append(new Option(link.label,link.id));
    }
    if(links.some(link=>link.id===previous))$('filter').value=previous;
    if(!links.length){const p=document.createElement('p');p.className='muted';p.textContent='还没有专属链接，先为对方创建一个。';$('links').append(p);}
  }
  function recordsPath(after, limit, filter) {
    const params=new URLSearchParams({select:'id,link_id,fruit,spun_at,received_at',order:'received_at.desc,id.desc',limit:String(limit)});
    if(filter)params.set('link_id',`eq.${filter}`);
    if(after)params.set('or',`(received_at.lt.${after.received_at},and(received_at.eq.${after.received_at},id.lt.${after.id}))`);
    return `/rest/v1/spin_records?${params}`;
  }
  async function loadRecords(reset=true) {
    const version=reset?++queryVersion:queryVersion,filter=$('filter').value;
    if(reset){cursor=null;loaded=0;$('records').replaceChildren();$('load-more').hidden=true;}
    $('refresh').disabled=true;$('load-more').disabled=true;
    try{
      const rows=await api(recordsPath(cursor,PAGE_SIZE,filter));
      if(version!==queryVersion)return;
      for(const record of rows){const row=document.createElement('tr');row.append(td(links.find(link=>link.id===record.link_id)?.label||'专属链接'),td(displayTime(record.spun_at)),td(record.fruit),td(displayTime(record.received_at)));$('records').append(row);}
      if(rows.length)cursor=rows[rows.length-1];loaded+=rows.length;
      $('summary').textContent=loaded?`已显示 ${loaded} 条记录 · 重复转到同一种水果也逐条保留`:'暂无记录，对方用专属链接转盘并同步后会显示在这里。';
      $('load-more').hidden=rows.length<PAGE_SIZE;
    }finally{if(version===queryVersion){$('refresh').disabled=false;$('load-more').disabled=false;}}
  }
  async function openDashboard() {
    const user=await api('/auth/v1/user');
    $('account').textContent=`当前邮箱：${user.email}`;$('login').hidden=true;$('dashboard').hidden=false;
    await loadLinks();await loadRecords();message('');
  }
  $('login-form').addEventListener('submit',async event=>{
    event.preventDefault();if(!configured)return message('结果后台尚未配置完成。');
    const button=event.submitter;button.disabled=true;
    try{
      const redirect=new URL('./admin.html',location.href).href;
      const response=await fetch(`${config.url}/auth/v1/otp?redirect_to=${encodeURIComponent(redirect)}`,{method:'POST',headers:{apikey:config.publishableKey,'Content-Type':'application/json'},body:JSON.stringify({email:$('email').value.trim(),create_user:true})});
      await responseJSON(response);message('登录链接已发送，请在邮箱中打开。若未收到，请检查垃圾邮件或稍后重试。');
    }catch(error){fail(error);}finally{button.disabled=false;}
  });
  $('link-form').addEventListener('submit',async event=>{
    event.preventDefault();const label=$('link-label').value.trim();if(!label)return;
    event.submitter.disabled=true;
    try{await api('/rest/v1/share_links',{method:'POST',body:JSON.stringify({label}),headers:{Prefer:'return=representation'}});$('link-label').value='';await loadLinks();message('已创建专属链接，复制后发给对方。');}catch(error){fail(error);}finally{event.submitter.disabled=false;}
  });
  $('refresh').addEventListener('click',()=>loadRecords().catch(fail));
  $('filter').addEventListener('change',()=>loadRecords().catch(fail));
  $('load-more').addEventListener('click',()=>loadRecords(false).catch(fail));
  $('logout').addEventListener('click',async()=>{try{await api('/auth/v1/logout',{method:'POST'});}catch(_){}storeSession(null);links=[];$('links').replaceChildren();$('records').replaceChildren();showLogin();message('已退出登录。');});
  const csvCell=value=>'"'+String(value).replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
  $('export').addEventListener('click',async()=>{
    $('export').disabled=true;message('正在导出当前筛选下的全部记录……');
    try{
      const filter=$('filter').value,rows=[];let after=null,batch;
      do{batch=await api(recordsPath(after,1000,filter));rows.push(...batch);if(batch.length)after=batch[batch.length-1];}while(batch.length===1000);
      const csv=[['对方','转盘时间（北京时间）','水果','同步时间（北京时间）'],...rows.map(record=>[links.find(link=>link.id===record.link_id)?.label||'专属链接',displayTime(record.spun_at),record.fruit,displayTime(record.received_at)])].map(row=>row.map(csvCell).join(',')).join('\r\n');
      const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download='王哥代下单-转盘记录.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message(`已导出 ${rows.length} 条记录。`);
    }catch(error){fail(error);}finally{$('export').disabled=false;}
  });
  async function initialize(){
    if(!configured){message('结果后台尚未连接数据库，请先完成配置。');$('login-form').querySelector('button').disabled=true;return;}
    const fragment=new URLSearchParams(location.hash.slice(1));
    if(fragment.get('error_description')){message(fragment.get('error_description'));history.replaceState(null,'',location.pathname);return;}
    if(fragment.get('access_token')){
      storeSession({access_token:fragment.get('access_token'),refresh_token:fragment.get('refresh_token'),expires_at:Math.floor(Date.now()/1000)+Number(fragment.get('expires_in')||3600)});
      history.replaceState(null,'',location.pathname);
    }else{try{session=JSON.parse(localStorage.getItem(SESSION_KEY));}catch(_){}}
    if(session)try{await openDashboard();}catch(error){fail(error);}
  }
  window.addEventListener('hashchange',()=>{if(location.hash.includes('access_token=') || location.hash.includes('error_description='))void initialize();});
  void initialize();
})();
