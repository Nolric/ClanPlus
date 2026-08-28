/* Clan Plus — le corps de l'application
   Sorti de index.html pour être partagé avec progression.html : il ne
   doit exister qu'UNE version des règles de calcul du SR, du coach et
   des cartes. Deux copies auraient dérivé.
   Chargé en différé, donc après lecture complète de la page. */

"use strict";

/* ============================================================
   CONFIG  (valeurs publiques)
   ============================================================ */
const SUPABASE_URL = "https://hlvqofgtwkkmbjmstmuc.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsdnFvZmd0d2trbWJqbXN0bXVjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5MzA5MDksImV4cCI6MjA5OTUwNjkwOX0.-zetkqR2LMffbCDfrDe4bz4MJVngUzbcxGdbazdWqEI";
const WG_APP_ID = "afd929f43761db6b5061b70d44b9f9b7";
const WG_API = "https://api.worldoftanks.eu";
const FN = SUPABASE_URL + "/functions/v1/";
const LS_SESSION = "cp_session";

function fnCall(name, body){
  return fetch(FN+name, {
    method:"POST",
    headers:{ "content-type":"application/json", "apikey":SUPABASE_ANON, "Authorization":"Bearer "+SUPABASE_ANON },
    // ⭐ Le serveur ne peut pas DEVINER le mode test : on le lui dit, DANS LE CORPS.
    // Sans ça, ses ADMIN_IDS accordaient l'édition en permanence — d'où un simple
    // soldat capable d'enregistrer des stratégies hors ?dev.
    // ⚠️ Surtout PAS un en-tête personnalisé : il déclencherait un préflight CORS que
    // les fonctions non mises à jour refusent (site bloqué au chargement). Un champ
    // de corps inconnu, lui, est simplement ignoré par une ancienne fonction.
    body: JSON.stringify(DEV ? { ...(body||{}), dev:true } : body),
  }).then(async r=>{ const j=await r.json().catch(()=>({error:"réponse invalide"})); return {ok:r.ok, status:r.status, j}; });
}
function redirectUri(){ return location.origin + location.pathname; }
function wgLoginUrl(){
  return WG_API + "/wot/auth/login/?application_id=" + WG_APP_ID +
         "&redirect_uri=" + encodeURIComponent(redirectUri()) + "&display=page";
}

/* ============================================================
   ÉTAT
   ============================================================ */
let RAW = [];   // lignes joueur enrichies (avec ts/mode/result de la bataille)
let MEMBERS = [];   // roster du clan (importé de l'API Wargaming)
let ME_ID = null;   // account_id du joueur connecté
const state = { mode:"", days:0, search:"", sortKey:"ce", sortDir:-1 };
// clés normalisées (minuscules, espaces/tirets -> underscore) : gère "Private" comme "private"
const normRole = r => String(r||"").toLowerCase().replace(/[\s-]+/g,"_");
const ROLE_ORDER = {commander:0,deputy_commander:1,executive_officer:1,combat_officer:2,personnel_officer:2,
  recruitment_officer:2,intelligence_officer:2,quartermaster:2,junior_officer:3,private:4,recruit:5,reservist:6};
// Administrateurs de l'application : accès TOTAL, quel que soit le grade dans le clan.
// Doit rester aligné avec ADMIN_IDS des fonctions Supabase (qui, elles, font foi
// pour les enregistrements). Sans ça le site recalculait les droits dans son coin
// et bloquait l'admin alors que le serveur l'autorisait.
// ⚠️ Les pouvoirs d'admin ne s'appliquent QU'EN MODE TEST (?dev=1). Hors mode test,
// on retrouve son VRAI grade dans le clan -> permet de vérifier l'expérience d'un
// simple membre. (Le serveur, lui, garde ADMIN_IDS en permanence.)
const APP_ADMINS = [539467185, 504857706];   // Robert · BeNoBaX (A-T-O)
function isAppAdmin(){ return DEV && ME_ID!=null && APP_ADMINS.includes(Number(ME_ID)); }
// Droits d'édition CÔTÉ CLIENT : basés sur le VRAI grade WG du joueur, sauf en mode DEV
// ou pour un administrateur (qui débloquent tout comme un commandant).
function meIsManager(){
  if(DEV) return true;                 // mode test : accès complet
  const m=(MEMBERS||[]).find(x=>Number(x.account_id)===Number(ME_ID));
  return !!m && (ROLE_ORDER[normRole(m.wg_role)] ?? 9) <= 2;
}
const ROLE_FR = {commander:"Commandant",deputy_commander:"Commandant adjoint",executive_officer:"Officier exécutif",
  combat_officer:"Officier de combat",personnel_officer:"Officier du personnel",recruitment_officer:"Recruteur",
  intelligence_officer:"Officier renseignement",quartermaster:"Intendant",junior_officer:"Officier subalterne",
  private:"Soldat",recruit:"Recrue",reservist:"Réserviste"};

/* ============================================================
   FLUX DE CONNEXION
   ============================================================ */
let DEV=false;   // mode test : débloque l'interface officier/commandant (côté client)
async function boot(){
  document.documentElement.setAttribute("data-theme", "dark");   // thème SOMBRE uniquement
  if(localStorage.getItem("cp_sidebar")==="1") document.getElementById("sidebar").classList.add("collapsed");

  // Mode test : ?dev l'active (persiste), ?dev=0 le coupe.
  const dv=new URLSearchParams(location.search).get("dev");
  if(dv!=null){ if(dv==="0") localStorage.removeItem("cp_dev"); else localStorage.setItem("cp_dev","1"); }
  DEV=localStorage.getItem("cp_dev")==="1";
  if(DEV){ const b=document.createElement("div"); b.textContent="MODE TEST"; b.title="Interface officier débloquée (clic pour quitter)";
    b.style.cssText="position:fixed;bottom:12px;right:12px;z-index:200;background:#e5b95c;color:#141310;font:700 11px system-ui;letter-spacing:.5px;padding:5px 11px;border-radius:20px;cursor:pointer;box-shadow:0 3px 10px rgba(0,0,0,.4)";
    b.onclick=()=>{ localStorage.removeItem("cp_dev"); location.href=location.pathname; }; document.body.appendChild(b); }

  // 1) Retour de Wargaming ? (l'URL contient status=ok&access_token=…)
  const p = new URLSearchParams(location.search);
  if(p.get("status")==="ok" && p.get("access_token")){
    // Le jeton est gardé EN MÉMOIRE et retiré de l'URL tout de suite : il n'a
    // rien à faire dans l'historique du navigateur. Le bouton « Réessayer »
    // rejoue la connexion depuis cette variable, sans repasser par Wargaming.
    const idsWg = {
      access_token: p.get("access_token"),
      account_id: p.get("account_id"),
      nickname: p.get("nickname"),
    };
    history.replaceState({}, "", redirectUri());
    await connecteWg(idsWg);
    return;
  }
  /* Wargaming a refusé AVANT de nous renvoyer un jeton. On arrive ici avec
     ?status=error&message=…&code=… — par exemple AUTH_ERROR / 410, observé
     en conditions réelles puis réussi à l'essai suivant.

     ⚠️ Ce code affichait « Connexion Wargaming annulée » pour TOUTES ces
     erreurs. C'est faux dans presque tous les cas : seul AUTH_CANCEL est
     une annulation. Dire à quelqu'un qu'il a annulé alors que le serveur a
     échoué, c'est l'envoyer chercher le problème chez lui.

     On distingue donc l'annulation du reste, on donne un bouton qui
     relance directement Wargaming, et on écrit le code dans la console
     pour pouvoir diagnostiquer si ça se répète. */
  if(p.get("status")==="error"){
    const msgWg  = (p.get("message") || "").toUpperCase();
    const codeWg = p.get("code") || "";
    history.replaceState({}, "", redirectUri());
    console.warn("[connexion] Wargaming a refusé — message:", msgWg || "?", "| code:", codeWg || "?");
    if(msgWg === "AUTH_CANCEL"){
      loginErrAvecReprise("Connexion annulée.", () => { location.href = wgLoginUrl(); }, "Réessayer");
    }else{
      const detail = msgWg ? (msgWg + (codeWg ? " " + codeWg : "")) : ("code " + (codeWg || "inconnu"));
      loginErrAvecReprise(
        "Wargaming n'a pas pu terminer la connexion (" + detail + "). C'est en général passager.",
        () => { location.href = wgLoginUrl(); }, "Réessayer");
    }
    return;
  }

  // 2) Session déjà présente ?
  if(localStorage.getItem(LS_SESSION)){
    if(localStorage.getItem("cp_clan")===""){ location.href = "trouver-clan.html"; return; } // session sans clan → Trouver un clan
    await openApp(); return;
  }

  // 3) Sinon, page d'accueil publique
  wireLanding();
  showLanding();
}

async function openApp(){
  // Révèle l'app avec le skeleton de chargement pendant la requête.
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  document.getElementById("loading").classList.remove("hidden");
  document.getElementById("subbar").classList.add("hidden");
  ["viewClan","viewBattles","viewLineups","viewLoadouts","viewStrats","viewRanking","viewSearch","viewRecruit"].forEach(id=>document.getElementById(id).classList.add("hidden"));

  /* Même problème que la connexion : un incident passager côté Supabase ou
     Wargaming laissait l'utilisateur devant un message sec, sans recours.
     Trois tentatives, puis un bouton. La session expirée (401) reste
     définitive : on la retire et on renvoie à l'écran de connexion. */
  let res = null;
  for(let n = 1; n <= 3; n++){
    res = await fnCall("clan-data", { session: localStorage.getItem(LS_SESSION) });
    if(res.ok || res.status === 401) break;
    if(n === 3) break;            // ne pas attendre après la dernière tentative
    document.querySelector("#loading .cp-load-txt").textContent =
      "Le serveur est occupé — nouvelle tentative (" + (n + 1) + "/3)…";
    await new Promise(r => setTimeout(r, n * 1200));
  }
  document.getElementById("loading").classList.add("hidden");
  if(!res.ok){
    if(res.status===401){
      // 14 jours écoulés : on le DIT, au lieu de renvoyer sans explication
      localStorage.removeItem(LS_SESSION);
      showLoginError("Ta session a expiré. Reconnecte-toi avec ton compte Wargaming.");
      return;
    }
    showLogin();
    const e = document.getElementById("loginErr");
    e.textContent = "Impossible de charger les données du clan. ";
    const b = document.createElement("button");
    b.type="button"; b.textContent="Réessayer";
    b.style.cssText="margin-left:6px;font:inherit;font-weight:600;color:var(--accent);"
      + "background:none;border:0;text-decoration:underline;cursor:pointer;padding:0";
    b.onclick = () => openApp();
    e.appendChild(b);
    e.classList.remove("hidden");
    console.warn("[clan-data] échec :", res.status, res.j && res.j.error);
    return;
  }
  buildRaw(res.j);
  srInit(res.j);   // modèle SR figé de la saison + profils joueurs + cotes Bastion
  MEMBERS = res.j.members || [];
  ME_ID = res.j.me ? res.j.me.account_id : null;
  CLANINFO = res.j.clanInfo || null;
  CLANRATINGS = res.j.clanRatings || null;
  // en-tête
  const clan = res.j.clan||{};
  document.getElementById("clanTitle").textContent = clan.tag ? ("["+clan.tag+"] "+(clan.name||"")) : "Ton clan";
  document.getElementById("clanSub").textContent = "Statistiques Bastion";
  document.getElementById("who").innerHTML = '<span class="odot on"></span>Connecté&nbsp;<b>'+esc(res.j.me?.nickname||"")+"</b>";
  document.getElementById("subbar").classList.remove("hidden");
  document.getElementById("viewClan").classList.remove("hidden");
  placeSubbar("clan");
  loadClanProfile();   // nationalité (non bloquant)
  loadClanEvents();    // calendrier + prochaine activité du bandeau (non bloquant)
  wireUI();
  rebuildFilters();
  render();
  renderMembers();
  renderClanInfo();
  populatePlayerSel();
}

let CLANINFO=null, CLANRATINGS=null;
function fmtDesc(s){
  let t=esc(String(s||""));
  // liens au format WoT :  "libellé":url  ->  lien cliquable propre
  t=t.replace(/&quot;([^&]+?)&quot;\s*:\s*(https?:\/\/[^\s]+)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
  t=t.replace(/\*(.+?)\*/g,"<b>$1</b>");   // *gras*
  return t;
}
function ratCard(label,obj,meaning,isPct){
  if(!obj || obj.value==null) return "";
  const val = isPct ? (fmt(obj.value,2)+" %") : fmt(obj.value);
  let rank="";
  if(obj.rank!=null){
    let d="";
    if(obj.rank_delta){ const up=obj.rank_delta>0;
      d=`<span class="${up?"up":"down"}" title="évolution du classement">${up?"▲":"▼"}${Math.abs(obj.rank_delta)}</span>`; }
    rank=`<div class="rr">Rang ${fmt(obj.rank)} ${d}</div>`;
  }
  return `<div class="rat"><div class="rl">${esc(label)}</div><div class="rv">${val}</div>${rank}${meaning?`<div class="rmean">${esc(meaning)}</div>`:""}</div>`;
}
function renderClanInfo(){
  renderDashHero();
  const de=document.getElementById("dashDesc");
  const desc=CLANINFO&&CLANINFO.description;
  if(!desc){ de.innerHTML=""; return; }
  de.innerHTML=`<div class="d2card desc2 dash-anim" style="--di:5">
    <div class="dt"><svg class="ic tti"><use href="#i-doc"/></svg><b>Description du clan &amp; recrutement</b>${CLANINFO.motto?` — « ${esc(CLANINFO.motto)} »`:""}</div>
    <button class="exp" id="descExp">Déplier ▾</button></div>
  <div class="d2card hidden" id="descBody" style="margin-top:8px"><div class="desc2-body">${fmtDesc(desc)}</div></div>`;
  const b=document.getElementById("descExp");
  if(b) b.onclick=()=>{ const body=document.getElementById("descBody"); const nowHidden=body.classList.toggle("hidden"); b.textContent=nowHidden?"Déplier ▾":"Replier ▴"; };
}
function clanBlockHTML(info, rt){
  let h="";
  if(rt){
    h+=`<div class="sec-h">Le niveau officiel du clan</div>
      <p class="sec-desc">Ces chiffres viennent <b>directement de Wargaming</b> et situent le clan <b>parmi tous les clans</b>.
      Le « <b>Rang</b> » est la position au classement (<b>rang 1 = le meilleur</b>) ;
      <span class="tagpos">▲</span> = le clan monte, <span class="tagneg">▼</span> = il descend.</p>`;
    h+=`<div class="rat-grouplabel">🛡️ En Bastion / Forteresse <span class="hint" style="font-weight:400">(l'Elo global et le classement sont déjà en haut)</span></div><div class="rat-grid">`;
    h+=ratCard("Bastion tier 10", rt.fb_elo_rating_10, "parties en tier 10");
    h+=ratCard("Bastion tier 8", rt.fb_elo_rating_8, "parties en tier 8");
    h+=ratCard("Bastion tier 6", rt.fb_elo_rating_6, "parties en tier 6");
    h+=ratCard("Score Forteresse", rt.rating_fort, "activité de la forteresse");
    h+=`</div>`;
    h+=`<div class="rat-grouplabel">🌍 En Clan Wars (carte globale)</div><div class="rat-grid">`;
    h+=ratCard("Niveau Carte Globale", rt.gm_elo_rating, "force en campagne mondiale");
    h+=`</div>`;
    h+=`<div class="rat-grouplabel">📊 Général</div><div class="rat-grid">`;
    h+=ratCard("Efficacité", rt.efficiency, "efficacité globale du clan");
    h+=ratCard("% de victoires moyen", rt.wins_ratio_avg, "moyenne de tous les joueurs", true);
    h+=ratCard("Niveau moyen des joueurs", rt.global_rating_avg, "indice de perf. global (type WN8)");
    h+=`</div>`;
  }
  return h;
}

/* ============================================================
   DASHBOARD "MON CLAN" — hero, profil éditable (nationalité +
   prochaine opération), KPIs animés, évolution, à la une.
   ============================================================ */
let CLANPROFILE=null, CPROF_CANEDIT=false;
const REDUCE_MOTION=matchMedia("(prefers-reduced-motion:reduce)").matches;
const LANGS=[["fr","🇫🇷","France"],["be","🇧🇪","Belgique"],["ch","🇨🇭","Suisse"],["ca","🇨🇦","Canada"],
  ["lu","🇱🇺","Luxembourg"],["de","🇩🇪","Allemagne"],["gb","🇬🇧","Royaume-Uni"],["es","🇪🇸","Espagne"],
  ["it","🇮🇹","Italie"],["pt","🇵🇹","Portugal"],["nl","🇳🇱","Pays-Bas"],["pl","🇵🇱","Pologne"],
  ["cz","🇨🇿","Tchéquie"],["sk","🇸🇰","Slovaquie"],["hu","🇭🇺","Hongrie"],["ro","🇷🇴","Roumanie"],
  ["gr","🇬🇷","Grèce"],["se","🇸🇪","Suède"],["no","🇳🇴","Norvège"],["fi","🇫🇮","Finlande"],
  ["dk","🇩🇰","Danemark"],["ua","🇺🇦","Ukraine"],["tr","🇹🇷","Turquie"],["ma","🇲🇦","Maroc"],
  ["dz","🇩🇿","Algérie"],["tn","🇹🇳","Tunisie"]];
const langOf=c=>LANGS.find(l=>l[0]===c);
// Drapeaux en SVG (les emojis-drapeaux ne s'affichent pas sous Windows -> on dessine).
const FLAGSPEC={
  fr:['v','#002654','#fff','#ED2939'], be:['v','#2d2926','#FAE042','#ED2939'], it:['v','#008C45','#F4F5F0','#CD212A'],
  ro:['v','#002B7F','#FCD116','#CE1126'],
  de:['h','#000','#DD0000','#FFCE00'], lu:['h','#ED2939','#fff','#00A1DE'], nl:['h','#AE1C28','#fff','#21468B'],
  hu:['h','#CD2A3E','#fff','#436F4D'], sk:['h','#fff','#0B4EA2','#EE1C25'],
  pl:['h','#fff','#DC143C'], ua:['h','#0057B7','#FFD500'],
  se:['cross','#006AA7','#FECC02'], fi:['cross','#fff','#003580'], dk:['cross','#C8102E','#fff'],
  no:['cross','#BA0C2F','#fff','#00205B'], ch:['ch'],
  es:['es'], pt:['pt'], cz:['cz'], gr:['gr'], ca:['ca'], gb:['gb'], tr:['tr'], ma:['ma'], dz:['dz'], tn:['tn'],
};
function flagBody(S){
  const t=S[0];
  if(t==='v'){ const c=S.slice(1),w=3/c.length; return c.map((col,i)=>`<rect x="${i*w}" width="${w}" height="2" fill="${col}"/>`).join(''); }
  if(t==='h'){ const c=S.slice(1),h=2/c.length; return c.map((col,i)=>`<rect y="${i*h}" width="3" height="${h}" fill="${col}"/>`).join(''); }
  if(t==='cross'){ const base=S[1],cr=S[2],inner=S[3]; let b=`<rect width="3" height="2" fill="${base}"/>`;
    b+=`<rect y="0.775" width="3" height="0.45" fill="${cr}"/><rect x="0.875" width="0.45" height="2" fill="${cr}"/>`;
    if(inner) b+=`<rect y="0.91" width="3" height="0.18" fill="${inner}"/><rect x="1.01" width="0.18" height="2" fill="${inner}"/>`;
    return b; }
  if(t==='ch'){ return `<rect width="3" height="2" fill="#DA291C"/><rect x="1.35" y="0.55" width="0.3" height="0.9" fill="#fff"/><rect x="1.05" y="0.85" width="0.9" height="0.3" fill="#fff"/>`; }
  if(t==='es'){ return `<rect width="3" height="2" fill="#AA151B"/><rect y="0.5" width="3" height="1" fill="#F1BF00"/>`; }
  if(t==='pt'){ return `<rect width="3" height="2" fill="#DA291C"/><rect width="1.2" height="2" fill="#046A38"/><circle cx="1.2" cy="1" r="0.3" fill="#FFE000" stroke="#fff" stroke-width="0.06"/>`; }
  if(t==='cz'){ return `<rect width="3" height="1" fill="#fff"/><rect y="1" width="3" height="1" fill="#D7141A"/><path d="M0 0 L1.4 1 L0 2 Z" fill="#11457E"/>`; }
  if(t==='gr'){ let s=''; for(let i=0;i<5;i++) s+=`<rect y="${i*0.4}" width="3" height="0.4" fill="${i%2?'#fff':'#0D5EAF'}"/>`; s+=`<rect width="1.2" height="1.2" fill="#0D5EAF"/><rect x="0.5" width="0.2" height="1.2" fill="#fff"/><rect y="0.5" width="1.2" height="0.2" fill="#fff"/>`; return s; }
  if(t==='ca'){ return `<rect width="3" height="2" fill="#fff"/><rect width="0.75" height="2" fill="#FF0000"/><rect x="2.25" width="0.75" height="2" fill="#FF0000"/><path d="M1.5 0.6 l0.08 0.26 0.26 -0.05 -0.11 0.24 0.2 0.13 -0.2 0.08 0.03 0.22 -0.22 -0.13 -0.22 0.13 0.03 -0.22 -0.2 -0.08 0.2 -0.13 -0.11 -0.24 0.26 0.05 z" fill="#FF0000"/>`; }
  if(t==='gb'){ return `<rect width="3" height="2" fill="#012169"/><path d="M0 0 L3 2 M3 0 L0 2" stroke="#fff" stroke-width="0.4"/><path d="M0 0 L3 2" stroke="#C8102E" stroke-width="0.18"/><path d="M3 0 L0 2" stroke="#C8102E" stroke-width="0.18"/><rect x="1.2" width="0.6" height="2" fill="#fff"/><rect y="0.7" width="3" height="0.6" fill="#fff"/><rect x="1.35" width="0.3" height="2" fill="#C8102E"/><rect y="0.85" width="3" height="0.3" fill="#C8102E"/>`; }
  if(t==='tr'){ return `<rect width="3" height="2" fill="#E30A17"/><circle cx="1.15" cy="1" r="0.45" fill="#fff"/><circle cx="1.3" cy="1" r="0.36" fill="#E30A17"/><path d="M1.72 1 l0.44 -0.14 -0.27 0.37 0 -0.46 0.27 0.37 z" fill="#fff"/>`; }
  if(t==='ma'){ return `<rect width="3" height="2" fill="#C1272D"/><path d="M1.5 0.7 l0.16 0.49 0.51 0 -0.42 0.3 0.16 0.49 -0.41 -0.3 -0.42 0.3 0.16 -0.49 -0.41 -0.3 0.51 0 z" fill="none" stroke="#006233" stroke-width="0.08"/>`; }
  if(t==='dz'){ return `<rect width="1.5" height="2" fill="#006233"/><rect x="1.5" width="1.5" height="2" fill="#fff"/><circle cx="1.55" cy="1" r="0.4" fill="#D21034"/><circle cx="1.67" cy="1" r="0.32" fill="#fff"/><path d="M1.95 1 l0.3 -0.1 -0.19 0.26 0 -0.32 0.19 0.26 z" fill="#D21034"/>`; }
  if(t==='tn'){ return `<rect width="3" height="2" fill="#E70013"/><circle cx="1.5" cy="1" r="0.48" fill="#fff"/><circle cx="1.6" cy="1" r="0.32" fill="#E70013"/><circle cx="1.67" cy="1" r="0.26" fill="#fff"/><path d="M1.62 1 l0.26 -0.08 -0.16 0.22 0 -0.28 0.16 0.22 z" fill="#E70013"/>`; }
  return `<rect width="3" height="2" fill="#3a3d42"/>`;
}
function flagSvg(code){ const S=FLAGSPEC[code]; const l=langOf(code);
  return `<svg class="flagsvg" viewBox="0 0 3 2" preserveAspectRatio="none" role="img" aria-label="${esc(l?l[2]:code||'')}">${S?flagBody(S):`<rect width="3" height="2" fill="#3a3d42"/>`}</svg>`; }

async function loadClanProfile(){
  try{
    const r=await fnCall("clan-profile",{session:localStorage.getItem(LS_SESSION),action:"get"});
    if(r.ok){ CLANPROFILE=r.j.profile||null; CPROF_CANEDIT=meIsManager(); }
  }catch(e){}
  if(DEV) CPROF_CANEDIT=true;
  renderDashHero();
}

/* ============================================================
   CALENDRIER D'ÉVÉNEMENTS DE CLAN (2e sous-onglet de la vue clan)
   ============================================================ */
let CLAN_EVENTS=[], CAL_CANEDIT=false, CAL_MONTH=null, CLAN_SUB="board";
const EV_KINDS={bastion:["Bastion","#e5b95c"],manoeuvres:["Manœuvres","#4bb6c6"],entrainement:["Entraînement","#4cc077"],autre:["Autre","#9b9b96"]};
function nextClanEvent(){ const now=Date.now()/1000; return (CLAN_EVENTS||[]).filter(e=>e.event_ts>now).sort((a,b)=>a.event_ts-b.event_ts)[0]||null; }
function switchClanSub(sub){
  CLAN_SUB=sub;
  document.querySelectorAll(".cv-tab").forEach(t=>t.classList.toggle("on",t.dataset.sub===sub));
  document.getElementById("clanDash").classList.toggle("hidden",sub!=="board");
  document.getElementById("clanCal").classList.toggle("hidden",sub!=="cal");
  if(sub==="cal"){ if(!CAL_MONTH) CAL_MONTH=new Date(); renderCalendar(); }
}
async function loadClanEvents(){
  try{
    const r=await fnCall("clan-events",{session:localStorage.getItem(LS_SESSION),action:"list"});
    if(r.ok){ CLAN_EVENTS=r.j.events||[]; CAL_CANEDIT=meIsManager(); }
    else { CAL_LOAD_ERR=(r.j&&r.j.error)||String(r.status); }
  }catch(e){ CAL_LOAD_ERR="réseau"; }
  if(DEV) CAL_CANEDIT=true;
  if(CLAN_SUB==="cal") renderCalendar();
  renderDashHero();
}
let CAL_LOAD_ERR=null;
function renderCalendar(){
  const cal=document.getElementById("clanCal"); if(!cal) return;
  if(!CAL_MONTH) CAL_MONTH=new Date();
  const y=CAL_MONTH.getFullYear(), m=CAL_MONTH.getMonth();
  const byDay={};
  CLAN_EVENTS.forEach(e=>{ const d=new Date(e.event_ts*1000); (byDay[d.getFullYear()+"-"+d.getMonth()+"-"+d.getDate()]=byDay[d.getFullYear()+"-"+d.getMonth()+"-"+d.getDate()]||[]).push(e); });
  const first=new Date(y,m,1), start=(first.getDay()+6)%7, dim=new Date(y,m+1,0).getDate();
  const t=new Date(), todayK=t.getFullYear()+"-"+t.getMonth()+"-"+t.getDate();
  let cells="";
  for(let i=0;i<start;i++) cells+='<div class="cal-cell empty"></div>';
  for(let d=1;d<=dim;d++){
    const k=y+"-"+m+"-"+d, evs=(byDay[k]||[]).sort((a,b)=>a.event_ts-b.event_ts);
    const evHtml=evs.map(e=>{ const kd=EV_KINDS[e.kind]||EV_KINDS.autre; const tm=new Date(e.event_ts*1000).toLocaleTimeString(window.CP_LOC,{hour:"2-digit",minute:"2-digit"});
      return `<div class="cal-ev" data-id="${e.id}" style="--evc:${kd[1]}" title="${esc(e.title)} · ${tm}"><b>${tm}</b> ${esc(e.title)}</div>`; }).join("");
    cells+=`<div class="cal-cell${k===todayK?' today':''}" data-day="${d}"><div class="cal-d">${d}</div><div class="cal-evs">${evHtml}</div></div>`;
  }
  const wd=["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];
  cal.innerHTML=`
    <div class="cal-head">
      <div class="cal-nav"><button class="cal-arrow" id="calPrev">‹</button><h3>${capFirst(CAL_MONTH.toLocaleDateString(window.CP_LOC,{month:"long",year:"numeric"}))}</h3><button class="cal-arrow" id="calNext">›</button><button class="cal-today-btn" id="calToday">Aujourd'hui</button></div>
      ${CAL_CANEDIT?'<button class="cal-add" id="calAdd">＋ Programmer un événement</button>':'<span class="cal-ro">Consultation — réservé aux officiers du personnel et +</span>'}
    </div>
    ${CAL_LOAD_ERR?`<div class="d2card" style="padding:14px;margin-bottom:12px;color:var(--bad)">Calendrier indisponible (${esc(CAL_LOAD_ERR)}) — la fonction « clan-events » est-elle déployée ?</div>`:""}
    <div class="cal-legend">${Object.values(EV_KINDS).map(v=>`<span class="cal-lg"><span class="cal-dot" style="background:${v[1]}"></span>${v[0]}</span>`).join("")}</div>
    <div class="cal-grid">${wd.map(d=>`<div class="cal-wd">${d}</div>`).join("")}${cells}</div>
    <div class="cal-up" id="calUp"></div>`;
  document.getElementById("calPrev").onclick=()=>{ CAL_MONTH=new Date(y,m-1,1); renderCalendar(); };
  document.getElementById("calNext").onclick=()=>{ CAL_MONTH=new Date(y,m+1,1); renderCalendar(); };
  document.getElementById("calToday").onclick=()=>{ CAL_MONTH=new Date(); renderCalendar(); };
  const add=document.getElementById("calAdd"); if(add) add.onclick=()=>openEventEditor(null,null);
  cal.querySelectorAll(".cal-ev").forEach(el=>el.onclick=(ev)=>{ ev.stopPropagation(); openEventEditor(CLAN_EVENTS.find(e=>String(e.id)===el.dataset.id)||null,null); });
  if(CAL_CANEDIT) cal.querySelectorAll(".cal-cell[data-day]").forEach(el=>el.onclick=()=>openEventEditor(null,new Date(y,m,+el.dataset.day,20,0)));
  renderCalUpcoming();
}
function renderCalUpcoming(){
  const el=document.getElementById("calUp"); if(!el) return;
  const now=Date.now()/1000;
  const up=CLAN_EVENTS.filter(e=>e.event_ts>now-3600).sort((a,b)=>a.event_ts-b.event_ts).slice(0,6);
  if(!up.length){ el.innerHTML='<div class="cal-up-h">À venir</div><div class="cal-up-empty">Aucun événement programmé.</div>'; return; }
  el.innerHTML='<div class="cal-up-h">À venir</div>'+up.map(e=>{ const kd=EV_KINDS[e.kind]||EV_KINDS.autre; const d=new Date(e.event_ts*1000);
    const ds=capFirst(d.toLocaleDateString(window.CP_LOC,{weekday:"short",day:"numeric",month:"short"}))+" · "+d.toLocaleTimeString(window.CP_LOC,{hour:"2-digit",minute:"2-digit"});
    return `<div class="cal-up-row" data-id="${e.id}"><span class="cal-dot" style="background:${kd[1]}"></span><span class="cal-up-t">${esc(e.title)}</span><span class="cal-up-k" style="color:${kd[1]}">${kd[0]}</span><span class="cal-up-d">${ds}</span></div>`; }).join("");
  el.querySelectorAll(".cal-up-row").forEach(r=>r.onclick=()=>openEventEditor(CLAN_EVENTS.find(e=>String(e.id)===r.dataset.id)||null,null));
}
function openEventEditor(ev, preset){
  const ro=!CAL_CANEDIT, e=ev||{};
  const d=e.event_ts?new Date(e.event_ts*1000):(preset||new Date());
  const dv=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")+"T"+String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");
  const kindOpts=Object.entries(EV_KINDS).map(([k,v])=>`<option value="${k}" ${e.kind===k?"selected":""}>${v[0]}</option>`).join("");
  let body;
  if(ro){
    const kd=EV_KINDS[e.kind]||EV_KINDS.autre;
    body=`<div class="ev-ro"><span class="cal-dot" style="background:${kd[1]}"></span> ${kd[0]}</div>
      <div class="ev-when">📅 ${capFirst(d.toLocaleDateString(window.CP_LOC,{weekday:"long",day:"numeric",month:"long",year:"numeric"}))} ${window.CP_LANG==="fr"?"à":"at"} ${d.toLocaleTimeString(window.CP_LOC,{hour:"2-digit",minute:"2-digit"})}</div>
      ${e.notes?`<div class="ev-notes">${esc(e.notes)}</div>`:""}
      ${e.created_by_name?`<div class="ev-by">Programmé par ${esc(e.created_by_name)}</div>`:""}`;
  }else{
    body=`<div class="ev-row"><label>Titre</label><input type="text" id="evTitle" maxlength="100" placeholder="Ex : Assaut Bastion T10" value="${esc(e.title||"")}"></div>
      <div class="ev-row2"><span><label>Type</label><select id="evKind">${kindOpts}</select></span><span><label>Date &amp; heure</label><input type="datetime-local" id="evWhen" value="${dv}"></span><span><label>Durée (min)</label><input type="number" id="evDur" min="0" max="600" step="15" value="${e.duration_min||60}"></span></div>
      <div class="ev-row"><label>Notes (optionnel)</label><textarea id="evNotes" maxlength="500" rows="2" placeholder="Consignes, chars, vocal…">${esc(e.notes||"")}</textarea></div>`;
  }
  const acts=ro?`<button class="btn primary" id="evClose">Fermer</button>`
    :`<button class="btn" id="evCancel">Annuler</button>${e.id?'<button class="btn" id="evDel" style="color:var(--bad)">Supprimer</button>':""}<button class="btn primary" id="evSave">Enregistrer</button>`;
  const ov=document.getElementById("evModal");
  ov.innerHTML=`<div class="ev-box"><button class="ev-x" id="evX">✕</button><h3>${ro?esc(e.title||"Événement"):(e.id?"Modifier l'événement":"Nouvel événement")}</h3>${body}<div class="ev-act">${acts}</div></div>`;
  ov.classList.remove("hidden");
  const close=()=>ov.classList.add("hidden");
  ov.onclick=( e2)=>{ if(e2.target===ov) close(); };
  document.getElementById("evX").onclick=close;
  const cc=document.getElementById("evClose")||document.getElementById("evCancel"); if(cc) cc.onclick=close;
  const del=document.getElementById("evDel"); if(del) del.onclick=()=>{ if(confirm("Supprimer cet événement ?")) deleteClanEvent(e.id); };
  const sv=document.getElementById("evSave"); if(sv) sv.onclick=()=>{
    const title=document.getElementById("evTitle").value.trim();
    const when=document.getElementById("evWhen").value;
    if(!title||!when){ alert("Il faut un titre et une date."); return; }
    saveClanEvent({id:e.id, title, kind:document.getElementById("evKind").value,
      event_ts:Math.floor(new Date(when).getTime()/1000),
      duration_min:parseInt(document.getElementById("evDur").value,10)||60,
      notes:document.getElementById("evNotes").value.trim()});
  };
}
async function saveClanEvent(evt){
  const r=await fnCall("clan-events",{session:localStorage.getItem(LS_SESSION),action:"save",event:evt});
  if(!r.ok){ alert("Erreur d'enregistrement : "+((r.j&&r.j.error)||r.status)); return; }
  document.getElementById("evModal").classList.add("hidden");
  await loadClanEvents();
}
async function deleteClanEvent(id){
  const r=await fnCall("clan-events",{session:localStorage.getItem(LS_SESSION),action:"delete",id});
  if(!r.ok){ alert("Erreur de suppression : "+((r.j&&r.j.error)||r.status)); return; }
  document.getElementById("evModal").classList.add("hidden");
  await loadClanEvents();
}

function renderDashHero(){
  const el=document.getElementById("dashHero");
  const info=CLANINFO;
  if(!info){ el.innerHTML=""; return; }
  const created=info.created_at? new Date(info.created_at*1000).toLocaleDateString(window.CP_LOC,{day:"2-digit",month:"2-digit",year:"numeric"}):"?";
  const emb=(info.emblems&&(info.emblems.x64&&(info.emblems.x64.wot||info.emblems.x64.portal)||info.emblems.x32&&info.emblems.x32.portal))||"";
  const emHtml=emb?`<img class="h2-em" src="${esc(emb)}" alt="${esc(info.tag||'')}">`:`<div class="h2-em h2-em-ph">${esc(info.tag||"")}</div>`;
  const langs=((CLANPROFILE&&CLANPROFILE.langs)||[]).map(langOf).filter(Boolean);
  const flags=langs.length? langs.map(l=>`<span class="h2-flag" title="${esc(l[2])}">${flagSvg(l[0])}</span>`).join("") : `<span class="h2-nolang">non précisée</span>`;
  const editN=CPROF_CANEDIT?`<button class="h2-edit" id="langEdit" title="Modifier la nationalité">✎</button>`:"";
  const now=Date.now()/1000;
  const nx=nextClanEvent();
  let opHtml;
  if(nx){
    const d=new Date(nx.event_ts*1000);
    const dstr=capFirst(d.toLocaleDateString(window.CP_LOC,{weekday:"long",day:"numeric",month:"long"}))+(window.CP_LANG==="fr"?" à ":" at ")+d.toLocaleTimeString(window.CP_LOC,{hour:"2-digit",minute:"2-digit"});
    const dh=nx.event_ts-now, days=Math.floor(dh/86400);
    const inTxt=days>0?("dans "+days+" j"):(dh>3600?("dans "+Math.floor(dh/3600)+" h"):"bientôt !");
    opHtml=`<div class="h2-op cal-link" id="opGo">
      <span class="h2-star">★</span>
      <div class="h2-op-l">Prochaine activité <span class="h2-op-in">${inTxt}</span></div>
      <div class="h2-op-t">${esc(nx.title)}</div>
      <div class="h2-op-d">📅 ${esc(dstr)}</div>
      <div class="h2-op-cta">Voir le calendrier →</div>
    </div>`;
  }else{
    opHtml=`<div class="h2-op cal-link" id="opGo">
      <span class="h2-star" style="opacity:.4;animation:none">★</span>
      <div class="h2-op-l">Prochaine activité</div>
      <div class="h2-op-t" style="color:var(--ink-2);font-size:14px">Aucune programmée</div>
      <div class="h2-op-cta">${(CAL_CANEDIT||CPROF_CANEDIT)?"Ouvrir le calendrier →":"Voir le calendrier →"}</div>
    </div>`;
  }
  el.innerHTML=`<div class="hero2 dash-anim" style="--di:0">
    ${emHtml}
    <div class="h2-ci">
      <div><span class="h2-tag">[${esc(info.tag||"")}]</span>${info.name?`<span class="h2-name">${esc(info.name)}</span>`:""}</div>
      ${info.motto?`<div class="h2-motto">« ${esc(info.motto)} »</div>`:""}
      <div class="h2-meta">
        <span>👥 <b>${fmt(info.members_count||0)}</b> membres</span>
        <span>📅 Créé le <b>${created}</b></span>
        <span class="h2-langs">🌐 ${flags} ${editN}</span>
      </div>
    </div>
    ${opHtml}
  </div>
  <div id="heroEditor" class="hidden"></div>`;
  const le=document.getElementById("langEdit"); if(le) le.onclick=openLangEditor;
  const og=document.getElementById("opGo"); if(og) og.onclick=()=>switchClanSub("cal");
}

/* --- éditeurs du hero (staff uniquement, vérifié aussi côté serveur) --- */
function heroEd(html){ const e=document.getElementById("heroEditor"); e.innerHTML=`<div class="h2-editor">${html}</div>`; e.classList.remove("hidden"); }
function closeHeroEd(){ const e=document.getElementById("heroEditor"); if(e){ e.classList.add("hidden"); e.innerHTML=""; } }
function langSel(i,cur){
  const opts=['<option value="">— aucune —</option>'].concat(LANGS.map(l=>`<option value="${l[0]}" ${cur===l[0]?"selected":""}>${l[2]}</option>`)).join("");
  return `<span class="he-langpick"><span class="he-flag" id="lflag${i}">${cur?flagSvg(cur):''}</span><select id="lsel${i}">${opts}</select></span>`;
}
function openLangEditor(){
  const cur=(CLANPROFILE&&CLANPROFILE.langs)||[];
  heroEd(`<b>🌐 Nationalité du clan</b><span class="he-hint">jusqu'à 3 langues, avec drapeau</span>
    <div class="he-row">${langSel(0,cur[0])}${langSel(1,cur[1])}${langSel(2,cur[2])}</div>
    <div class="he-act"><button class="btn" id="heCancel">Annuler</button><button class="btn primary" id="heSave">Enregistrer</button></div>`);
  [0,1,2].forEach(i=>{ const s=document.getElementById("lsel"+i); if(s) s.onchange=()=>{ const f=document.getElementById("lflag"+i); if(f) f.innerHTML=s.value?flagSvg(s.value):''; }; });
  document.getElementById("heCancel").onclick=closeHeroEd;
  document.getElementById("heSave").onclick=()=>{
    const langs=[...new Set([0,1,2].map(i=>document.getElementById("lsel"+i).value).filter(Boolean))];
    saveClanProfile({langs});
  };
}
function openOpEditor(){
  const p=CLANPROFILE||{};
  let dval="";
  if(p.op_ts){ const d=new Date(p.op_ts*1000);
    dval=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")
      +"T"+String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0"); }
  heroEd(`<b>★ Prochaine opération</b><span class="he-hint">affichée dans le bandeau pour tout le clan</span>
    <div class="he-row"><input type="text" id="opTitle" placeholder="Ex : Offensive sur la vallée" maxlength="80" value="${esc(p.op_title||"")}">
    <input type="datetime-local" id="opWhen" value="${dval}"></div>
    <div class="he-act"><button class="btn" id="heCancel">Annuler</button>${p.op_title?'<button class="btn" id="heClear">Retirer</button>':""}<button class="btn primary" id="heSave">Enregistrer</button></div>`);
  document.getElementById("heCancel").onclick=closeHeroEd;
  const cl=document.getElementById("heClear"); if(cl) cl.onclick=()=>saveClanProfile({op_title:null,op_ts:null});
  document.getElementById("heSave").onclick=()=>{
    const t=document.getElementById("opTitle").value.trim();
    const w=document.getElementById("opWhen").value;
    if(!t||!w){ alert("Il faut un titre et une date."); return; }
    saveClanProfile({op_title:t,op_ts:Math.floor(new Date(w).getTime()/1000)});
  };
}
async function saveClanProfile(patch){
  const p=CLANPROFILE||{};
  const body={session:localStorage.getItem(LS_SESSION),action:"save",
    langs:("langs" in patch)?patch.langs:(p.langs||[]),
    op_title:("op_title" in patch)?patch.op_title:(p.op_title||null),
    op_ts:("op_ts" in patch)?patch.op_ts:(p.op_ts||null)};
  const r=await fnCall("clan-profile",body);
  if(!r.ok){ alert("Erreur d'enregistrement : "+(r.j.error||r.status)); return; }
  CLANPROFILE=Object.assign({},CLANPROFILE||{},{langs:body.langs,op_title:body.op_title,op_ts:body.op_ts});
  renderDashHero();
}

/* --- KPIs animés + tendances (période courante vs période précédente) --- */
function dashFilterRows(days,shift){
  const now=Date.now()/1000;
  return RAW.filter(r=>{
    if(!r.isMember) return false;
    if(state.mode && r.mode!==state.mode) return false;
    if(days){ const age=now-(r.ts||0);
      if(shift){ if(age<=days*86400 || age>2*days*86400) return false; }
      else if(age>days*86400) return false; }
    return true;
  });
}
function dashStats(rows){
  const bres={}; rows.forEach(r=>{ if(!(r.battleId in bres)) bres[r.battleId]=r.result; });
  let wins=0,tot=0; Object.values(bres).forEach(res=>{ if(res===1)wins++; if(res!==-1&&res!=null)tot++; });
  // SR moyen du clan : moyenne des SR PAR BATAILLE du nouveau modèle (repli sur
  // l'ancien calcul si le modèle figé n'est pas encore disponible).
  let sr;
  if(srOk()){
    const ids=new Set(rows.map(r=>r.battleId));
    const v=srRows().filter(r=>ids.has(r.battleId)).map(r=>r.sr);
    sr = v.length ? v.reduce((a,b)=>a+b,0)/v.length : null;
  } else {
    sr = srAvg(rows);
  }
  const dmg=rows.length? rows.reduce((s,r)=>s+(r.dmg||0),0)/rows.length : 0;
  return {battles:Object.keys(bres).length, wins, tot, winrate:tot?wins/tot:0,
          sr: sr==null?null:Math.round(sr), dmg:Math.round(dmg)};
}
function trendTag(cur,prev,pctMode){
  const d=cur-prev;
  if(Math.abs(d)<(pctMode?0.005:1)) return `<span class="dk-t eq">→ stable</span>`;
  const up=d>0, txt=pctMode?(Math.abs(d*100).toFixed(0)+" pts"):fmt(Math.abs(Math.round(d)));
  return `<span class="dk-t ${up?"up":"down"}">${up?"▲":"▼"} ${txt}</span>`;
}
function animateNum(el,target,f){
  if(REDUCE_MOTION||!target){ el.textContent=f(target); return; }
  const t0=performance.now(), dur=800;
  let done=false;
  const step=t=>{ if(done) return;
    const p=Math.min(1,(t-t0)/dur), e=1-Math.pow(1-p,3);
    el.textContent=f(target*e);
    if(p<1) requestAnimationFrame(step); else { done=true; el.textContent=f(target); } };
  requestAnimationFrame(step);
  // filet de sécurité : si les frames sont gelées (onglet en fond), on force la valeur finale
  setTimeout(()=>{ if(!done){ done=true; el.textContent=f(target); } }, dur+150);
}
function renderDashKpis(){
  const el=document.getElementById("dashKpis"); if(!el) return;
  const cur=dashStats(dashFilterRows(state.days,0));
  const prev=state.days? dashStats(dashFilterRows(state.days,1)) : null;
  const rt=CLANRATINGS||{};
  const elo=rt.fb_elo_rating&&rt.fb_elo_rating.value;
  const rank=rt.fb_elo_rating&&rt.fb_elo_rating.rank;
  const rkD=(rt.fb_elo_rating&&rt.fb_elo_rating.rank_delta)||0;
  const tiles=[
    {ic:"i-shield",l:"SR moyen du clan",v:cur.sr,f:v=>fmt(Math.round(v)),sub:"réf. globale ≈ 1500",t:(prev&&prev.tot)?trendTag(cur.sr,prev.sr):"",cls:"gold"},
    {ic:"i-flag",l:"Victoires",v:cur.winrate*100,f:v=>v.toFixed(0)+" %",sub:cur.wins+" V · "+(cur.tot-cur.wins)+" D",t:(prev&&prev.tot)?trendTag(cur.winrate,prev.winrate,true):""},
    {ic:"i-sword",l:"Batailles",v:cur.battles,f:v=>fmt(Math.round(v)),sub:state.days?("sur "+state.days+" jours"):"enregistrées",t:(prev&&prev.tot)?trendTag(cur.battles,prev.battles):""},
    {ic:"i-bolt",l:"Dégâts moyens",v:cur.dmg,f:v=>fmt(Math.round(v)),sub:"par joueur / partie",t:(prev&&prev.tot)?trendTag(cur.dmg,prev.dmg):""},
    {ic:"i-target",l:"Elo Bastion",v:elo||0,f:v=>elo?fmt(Math.round(v)):"—",sub:"officiel Wargaming",t:""},
    {ic:"i-trophy2",l:"Classement",v:rank||0,f:v=>rank?("#"+fmt(Math.round(v))):"—",sub:"parmi tous les clans",
      t:rkD?`<span class="dk-t ${rkD>0?"up":"down"}">${rkD>0?"▲":"▼"} ${Math.abs(rkD)} place${Math.abs(rkD)>1?"s":""}</span>`:""},
  ];
  el.innerHTML=tiles.map((k,i)=>`<div class="dk dash-anim ${k.cls||""}" style="--di:${i+1}">
    <div class="dk-top"><span class="dk-ic"><svg class="ic"><use href="#${k.ic}"/></svg></span><span class="dk-l">${k.l}</span></div>
    <div class="dk-v">${k.f(0)}</div>
    <div class="dk-s">${k.sub} ${k.t||""}</div></div>`).join("");
  el.querySelectorAll(".dk-v").forEach((n,i)=>animateNum(n,tiles[i].v,tiles[i].f));
}

/* --- courbe d'évolution : % de victoires par jour, tracé animé --- */
function renderDashEvo(){
  const svg=document.getElementById("dashEvo"); if(!svg) return;
  const rows=dashFilterRows(state.days,0);
  const per={};
  rows.forEach(r=>{ if(!r.ts) return; const d=new Date(r.ts*1000);
    const k=d.getFullYear()+"-"+(d.getMonth()+1)+"-"+d.getDate();
    per[k]=per[k]||{}; if(!(r.battleId in per[k])) per[k][r.battleId]=r.result; });
  const days=Object.keys(per).map(k=>{ let w=0,t=0;
      Object.values(per[k]).forEach(res=>{ if(res===1)w++; if(res!=null&&res!==-1)t++; });
      return {k, t:new Date(k).getTime(), wr:t?w/t:null, n:Object.keys(per[k]).length}; })
    .filter(d=>d.wr!=null).sort((a,b)=>a.t-b.t);
  const W=svg.clientWidth||520, H=190, padL=38, padR=12, padT=14, padB=26;
  if(days.length<2){ svg.innerHTML=`<text x="${W/2}" y="${H/2}" text-anchor="middle">Pas encore assez de jours pour une courbe</text>`; return; }
  const x=i=>padL+i/(days.length-1)*(W-padL-padR), y=v=>padT+(1-v)*(H-padT-padB);
  let g="";
  [0,.25,.5,.75,1].forEach(v=>{ const yy=y(v);
    g+=`<line class="grid-line" x1="${padL}" y1="${yy}" x2="${W-padR}" y2="${yy}"/><text x="${padL-6}" y="${yy+3}" text-anchor="end">${Math.round(v*100)}</text>`; });
  let path="", area="M"+padL+","+(H-padB);
  days.forEach((d,i)=>{ const px=x(i),py=y(d.wr); path+=(i?"L":"M")+px+","+py+" "; area+="L"+px+","+py+" "; });
  area+="L"+x(days.length-1)+","+(H-padB)+" Z";
  g+=`<path class="area" d="${area}"/><path class="line" id="evoLine" d="${path}"/>`;
  days.forEach((d,i)=>{ g+=`<circle class="dot" cx="${x(i)}" cy="${y(d.wr)}" r="3"><title>${d.k} : ${Math.round(d.wr*100)} % (${d.n} bataille${d.n>1?"s":""})</title></circle>`; });
  [0,Math.floor((days.length-1)/2),days.length-1].forEach(i=>{
    g+=`<text x="${x(i)}" y="${H-8}" text-anchor="middle">${new Date(days[i].t).toLocaleDateString(window.CP_LOC,{day:"2-digit",month:"2-digit"})}</text>`; });
  g+=`<line class="axis-line" x1="${padL}" y1="${H-padB}" x2="${W-padR}" y2="${H-padB}"/>`;
  svg.innerHTML=g;
  const line=svg.querySelector("#evoLine");
  if(line && !REDUCE_MOTION){ try{
    const len=line.getTotalLength();
    line.style.strokeDasharray=len; line.style.strokeDashoffset=len;
    line.getBoundingClientRect();
    line.style.transition="stroke-dashoffset 1.1s ease .15s"; line.style.strokeDashoffset="0";
  }catch(e){} }
}

/* --- "À la une" ⭐ : MVP semaine, dernière bataille, série en cours --- */
function renderDashSpot(){
  const el=document.getElementById("dashSpot"); if(!el) return;
  const now=Date.now()/1000;
  const week=RAW.filter(r=>r.isMember&&r.ts&&(now-r.ts)<=7*86400);
  const per={};
  week.forEach(r=>{ const p=per[r.accId]=per[r.accId]||{name:r.name,n:0,s:0}; const _v=srBattle(r); if(_v!=null){ p.n++; p.s+=_v; } });
  const mvp=Object.values(per).filter(p=>p.n>=2)
    .map(p=>({name:p.name,ce:Math.round(p.s/p.n),n:p.n})).sort((a,b)=>b.ce-a.ce)[0];
  const bat={};
  RAW.forEach(r=>{ if(!r.isMember||!r.ts) return;
    const b=bat[r.battleId]=bat[r.battleId]||{id:r.battleId,ts:0,result:r.result,map:r.mapName};
    if(r.ts>b.ts) b.ts=r.ts; });
  const list=Object.values(bat).sort((a,b)=>b.ts-a.ts);
  const last=list[0];
  let streak=0, kind=null;
  for(const b of list){ if(b.result==null||b.result===-1) continue; const w=b.result===1;
    if(kind===null){ kind=w; streak=1; } else if(w===kind) streak++; else break; }
  const row=(ic,l,v,s)=>`<div class="sp-row"><span class="sp-ic">${ic}</span><div class="sp-tx"><div class="sp-l">${l}</div><div class="sp-v">${v}</div></div>${s?`<span class="sp-side">${s}</span>`:""}</div>`;
  let h=`<h2><span class="sp-star">★</span> À la une</h2>`;
  h+=mvp? row("👑","MVP de la semaine",esc(shortName(mvp.name))+" "+ceBadge(mvp.ce),mvp.n+" bat.")
        : row("👑","MVP de la semaine","— <span class='hint'>pas assez de batailles cette semaine</span>");
  if(last){
    const foeTag=(typeof BATTLE_ENEMY!=="undefined"&&BATTLE_ENEMY[last.id])||"?";
    const d=new Date(last.ts*1000).toLocaleDateString(window.CP_LOC,{day:"2-digit",month:"2-digit"});
    const res=last.result===1?'<b class="pos">Victoire</b>':(last.result===0?'<b class="neg">Défaite</b>':"Égalité");
    h+=row("⚔️","Dernière bataille",res+" vs ["+esc(foeTag)+"]",esc(cleanMap(last.map||""))+" · "+d);
  } else h+=row("⚔️","Dernière bataille","—");
  h+=(kind!==null&&streak>0)? row(kind?"🔥":"🧊","Série en cours",streak+" "+(kind?"victoire":"défaite")+(streak>1?"s":"")+" d'affilée")
                            : row("🔥","Série en cours","—");
  el.innerHTML=h;
}
/* ============ Rendu Dashboard v2 (noir/or dense) ============ */
function srColor(v){ return ceTier(v).c; }
function dashBattleList(){
  const bat={};
  RAW.forEach(r=>{ if(!r.isMember||!r.ts) return;
    const b=bat[r.battleId]=bat[r.battleId]||{id:r.battleId,ts:0,result:r.result,map:r.mapName};
    if(r.ts>b.ts) b.ts=r.ts; });
  return Object.values(bat).sort((a,b)=>b.ts-a.ts);
}
function dashMapThumb(name){ const k=mapKey(name); return k?`<img src="maps/${k}.jpg" alt="" onerror="this.style.display='none'">`:""; }

function renderHealth(){
  const el=document.getElementById("dashHealth"); if(!el) return;
  const cur=dashStats(dashFilterRows(state.days,0));
  const list=dashBattleList().filter(b=>b.result!=null&&b.result!==-1);
  const last10=list.slice(0,10).reverse();
  let streak=0,kind=null;
  for(const b of list){ const w=b.result===1; if(kind===null){kind=w;streak=1;} else if(w===kind)streak++; else break; }
  const bars=last10.map((b,i)=>{ const w=b.result===1;
    return `<div class="hcol"><div class="hbar ${w?'w':'l'}" style="height:${w?54:30}px"></div><div class="hbar-x">${last10.length-i}</div></div>`; }).join("");
  const streakTxt=(kind!==null&&streak>0)?`<span class="streak ${kind?'good':'bad'}">${kind?'▲':'▼'} ${streak} ${kind?'victoire':'défaite'}${streak>1?'s':''} d'affilée</span>`:"";
  el.innerHTML=`<div class="kpi-h"><svg class="ic"><use href="#i-heart"/></svg>Santé du clan <span class="hi">— Bastion</span></div>
    <div class="health"><div class="health-l">
      <div class="big">${(cur.winrate*100).toFixed(0)} %</div>
      <div class="big-s">de victoires · ${cur.battles} bataille${cur.battles>1?'s':''}<br>${cur.wins} V – ${cur.tot-cur.wins} D</div>
      ${streakTxt}
    </div><div class="hbars">${bars||'<span style="color:var(--muted);font-size:12px">Pas de batailles</span>'}</div></div>`;
}
/* Le retrait du MVP laissait ~60 px de vide en bas de cette carte, alors
   que ses deux voisines sont pleines. On comble avec les DEUX batailles
   précédentes : c'est la même donnée, déjà chargée, et ça transforme un
   instantané en une petite série — on voit l'enchaînement, pas un point.
   Un clic mène au débriefing de la bataille. */
function renderLast(){
  const el=document.getElementById("dashLast"); if(!el) return;
  const liste=dashBattleList();
  const last=liste[0];
  const ligne=(b)=>{
    const foeTag=(typeof BATTLE_ENEMY!=="undefined"&&BATTLE_ENEMY[b.id])||"?";
    const d=new Date(b.ts*1000).toLocaleDateString(window.CP_LOC,{day:"2-digit",month:"2-digit"});
    const gagne=b.result===1, nul=b.result!==1&&b.result!==0;
    return `<button type="button" class="lb-l${gagne?" w":(nul?"":" l")}" data-bid="${esc(String(b.id))}">
      <span class="lb-p"></span>
      <span class="lb-r">${gagne?"Victoire":(nul?"Égalité":"Défaite")}</span>
      <span class="lb-vs">vs [${esc(foeTag)}]</span>
      <span class="lb-m">${esc(cleanMap(b.map||""))}</span>
      <span class="lb-d">${d}</span>
    </button>`;
  };
  if(!last){
    el.innerHTML=`<div class="lb-inner"><div class="kpi-h"><svg class="ic"><use href="#i-swords"/></svg>Dernières batailles</div>
      <div class="lb-vide">Aucune bataille enregistrée pour l'instant.</div></div>`;
    return;
  }
  const bg=`<div class="lb-bg">${dashMapThumb(last.map)}</div>`;
  el.innerHTML=`${bg}<div class="lb-inner">
    <div class="kpi-h"><svg class="ic"><use href="#i-swords"/></svg>Dernières batailles</div>
    <div class="lb-liste">${liste.slice(0,3).map(ligne).join("")}</div></div>`;
  el.querySelectorAll(".lb-l").forEach(b=>b.onclick=()=>{
    // les trois plus récentes sont toujours en page 1 : on y revient, sinon
    // la bataille visée pourrait être sur une autre page
    if(typeof BL_PAGE!=="undefined") BL_PAGE=0;
    switchView("battles");
    // la vue se rend juste après : on laisse passer un tour d'horloge
    setTimeout(()=>{
      const c=document.querySelector(`.bl-row[data-bid="${CSS.escape(b.dataset.bid)}"]`);
      if(!c) return;                       // introuvable : on reste sur la vue, sans rien casser
      c.classList.add("open");             // le débriefing s'ouvre
      c.scrollIntoView({block:"center",behavior:"smooth"});
    }, 420);
  });
}
function ratVal(o,pct){ if(!o||o.value==null) return "—"; return pct?(fmt(o.value,2)+" %"):fmt(o.value); }
function ratRank(o){ if(!o||o.rank==null) return ""; let d=""; if(o.rank_delta){const up=o.rank_delta>0; d=` <span class="${up?'up':'dn'}">${up?'▲':'▼'}${Math.abs(o.rank_delta)}</span>`;} return "Rang "+fmt(o.rank)+d; }
function renderWg(){
  const el=document.getElementById("dashWg"); if(!el) return;
  const rt=CLANRATINGS||{}; const fb=rt.fb_elo_rating||{};
  const rkD=fb.rank_delta||0;
  const tier=(o,lbl)=>{ if(!o||o.value==null) return ""; let d=""; if(o.rank_delta){const up=o.rank_delta>0;d=` <span class="${up?'up':'dn'}">${up?'▲':'▼'}${Math.abs(o.rank_delta)}</span>`;} return `<div class="wg-tier"><span>${lbl}</span><span><b>${fmt(o.value)}</b>${d}</span></div>`; };
  el.innerHTML=`<div class="kpi-h"><svg class="ic"><use href="#i-award"/></svg>Classement Wargaming</div>
    <div class="wg"><div class="wg-l">
      <div class="wg-rank">${fb.rank?"#"+fmt(fb.rank):"—"}</div>
      ${rkD?`<div class="wg-d ${rkD>0?'up':'dn'}">${rkD>0?'▲':'▼'} ${Math.abs(rkD)} place${Math.abs(rkD)>1?'s':''}</div>`:""}
      <div class="wg-elo">Elo bastion <b>${fb.value?fmt(fb.value):"—"}</b></div>
    </div><div class="wg-tiers">${tier(rt.fb_elo_rating_10,"Bastion tier 10")}${tier(rt.fb_elo_rating_8,"Bastion tier 8")}${tier(rt.fb_elo_rating_6,"Bastion tier 6")}</div></div>`;
}
function renderMini(){
  const el=document.getElementById("dashMini"); if(!el) return;
  const rows=dashFilterRows(state.days,0);
  const cur=dashStats(rows);
  const frags=rows.length? rows.reduce((s,r)=>s+(r.kills||0),0)/rows.length : 0;
  const cards=[
    {l:"SR moyen du clan",v:fmt(cur.sr),s:"réf. globale ≈ 1500",hl:true},
    {l:"Dégâts moyens / joueur",v:fmt(cur.dmg),s:"par partie"},
    {l:"Batailles enregistrées",v:fmt(cur.battles),s:state.days?("sur "+state.days+" j"):"via le mod"},
    {l:"Frags moyens / partie",v:fmt(frags,2),s:"par joueur"},
  ];
  el.innerHTML=cards.map((c,i)=>`<div class="mini ${c.hl?'hl':''} dash-anim" style="--di:${i+1}"><div class="l">${c.l}</div><div class="v">${c.v}</div><div class="s">${c.s}</div></div>`).join("");
}
function renderOfficialCards(){
  const el=document.getElementById("dashOff"); if(!el) return;
  const rt=CLANRATINGS;
  if(!rt){ el.innerHTML='<div class="off" style="grid-column:1/-1;color:var(--muted)">Chiffres officiels indisponibles</div>'; return; }
  const cards=[
    {ic:"i-fort",l:"Forteresse",o:rt.rating_fort},
    {ic:"i-globe",l:"Carte globale",o:rt.gm_elo_rating},
    {ic:"i-bolt",l:"Efficacité",o:rt.efficiency},
    {ic:"i-flag",l:"% vict. moyen",o:rt.wins_ratio_avg,pct:true},
    {ic:"i-award",l:"Niveau joueurs",o:rt.global_rating_avg},
  ];
  el.innerHTML=cards.map((c,i)=>`<div class="off dash-anim" style="--di:${i+2}"><div class="off-h"><span class="off-ic"><svg class="ic"><use href="#${c.ic}"/></svg></span><span class="l">${c.l}</span></div><div class="v">${ratVal(c.o,c.pct)}</div><div class="r">${ratRank(c.o)}</div></div>`).join("");
}
/* Top 5 par IMPACT DÉCOMPOSÉ.
   Une barre empilée par joueur : dégâts directs + assistance + blocage.
   La forme de la barre raconte le rôle — un lourd est massif à droite
   (blocage), un léger l'est au milieu (assistance), un chasseur à gauche.
   Le trait pointillé marque la moyenne du clan : chacun se situe sans
   calcul. Palette validée (daltonisme + contraste) ; 2 px de fond entre
   les segments ; légende et valeurs écrites, donc jamais la couleur seule. */
/* Les trois notions que le jeu ne définit nulle part clairement.
   L'explication est portée par l'infobulle : sans elle, trois couleurs
   ne veulent rien dire. */
const T5_PARTS = [
  { k:"dmg",    l:"Dégâts",     c:"#bd8a3c",
    d:"Points de vie que tu retires toi-même à l'adversaire, en tirant." },
  { k:"assist", l:"Assistance", c:"#4f97ee",
    d:"Dégâts infligés par tes alliés sur une cible que TU as repérée, ou dont tu as brisé les chenilles." },
  { k:"block",  l:"Blocage",    c:"#c76fa4",
    d:"Dégâts encaissés par ton blindage sans perdre de points de vie : les obus qui ricochent ou ne percent pas." },
];
function renderTop5(){
  const el=document.getElementById("dashTop5"); if(!el) return;
  const agg=aggregate(dashFilterRows(state.days,0)).filter(p=>p.battles>=3);
  const tot=p=>T5_PARTS.reduce((s,x)=>s+(p[x.k]||0),0);
  const top=agg.slice().sort((a,b)=>tot(b)-tot(a)).slice(0,5);
  const moy=agg.length? agg.reduce((s,p)=>s+tot(p),0)/agg.length : 0;
  const mx=Math.max(1,moy*1.06,...top.map(tot));

  const legende=T5_PARTS.map(x=>
    `<span class="t5l" data-l="${x.l}" data-d="${esc(x.d)}" data-c="${x.c}">`+
    `<i style="background:${x.c}"></i>${x.l}</span>`).join("");

  const lignes=top.map((p,i)=>{
    const t=tot(p);
    const seg=T5_PARTS.map(x=>{
      const w=(p[x.k]||0)/mx*100;
      const part=t? Math.round((p[x.k]||0)/t*100) : 0;
      return w<0.6?"":`<span class="t5s" style="width:${w.toFixed(2)}%;background:${x.c}"`+
        ` data-l="${x.l}" data-v="${fmt(Math.round(p[x.k]||0))}" data-part="${part}"`+
        ` data-d="${esc(x.d)}" data-c="${x.c}"></span>`;
    }).join("");
    const ecart=moy? Math.round((t/moy-1)*100) : 0;
    const tag=Math.abs(ecart)<3?'<span class="t5e eq">= moyenne</span>'
      :`<span class="t5e ${ecart>0?"up":"dn"}">${ecart>0?"+":"−"}${Math.abs(ecart)} % vs moyenne</span>`;
    return `<div class="t5row" style="--i:${i}">
      <span class="t5rk r${i+1}">${i+1}</span>
      <div class="t5main">
        <div class="t5head"><span class="nm">${esc(shortName(p.name))}</span>
          <span class="vv">${fmt(Math.round(t))}</span></div>
        <span class="t5wrap"><span class="t5bar">${seg}</span><i class="t5ref"></i>${
          i===0?'<em class="t5reflbl">moyenne du clan</em>':""}</span>
        <div class="t5foot">${tag}<span class="t5b">${p.battles} bat.</span></div>
      </div></div>`;
  }).join("");

  el.innerHTML=`<div class="d2ttl"><h3><svg class="ic tti"><use href="#i-chart"/></svg>Impact moyen par bataille</h3></div>
    <div class="t5leg">${legende}</div>
    <div class="t5" style="--moyp:${(moy/mx*100).toFixed(2)}%">
      ${lignes||'<div style="color:var(--muted);font-size:12px;padding:8px 0">Aucune donnée</div>'}
    </div>`;
  brancheBulle(el);
}

/* ── L'infobulle ────────────────────────────────────────────────────
   Une seule bulle réutilisée, positionnée au-dessus du segment survolé.
   Elle sort du cadre de la carte si nécessaire (position:fixed), et se
   recale quand elle dépasserait le bord de la fenêtre. */
let T5_BULLE = null;
function brancheBulle(hote){
  if(!T5_BULLE){
    T5_BULLE = document.createElement("div");
    T5_BULLE.className = "t5bulle"; T5_BULLE.hidden = true;
    document.body.appendChild(T5_BULLE);
  }
  const montre = (el) => {
    const d = el.dataset;
    if(!d.l) return;
    T5_BULLE.innerHTML =
      '<b style="color:' + (d.c||"var(--ink)") + '">' + esc(d.l) + '</b>' +
      (d.v ? '<span class="v">' + d.v + (d.part ? ' &middot; ' + d.part + ' % de son impact' : '') + '</span>' : '') +
      '<span class="d">' + esc(d.d||"") + '</span>';
    T5_BULLE.hidden = false;
    const r = el.getBoundingClientRect(), b = T5_BULLE.getBoundingClientRect();
    let x = r.left + r.width/2 - b.width/2;
    x = Math.max(8, Math.min(x, innerWidth - b.width - 8));   // jamais hors écran
    let y = r.top - b.height - 10;
    if(y < 8) y = r.bottom + 10;                              // pas de place au-dessus
    T5_BULLE.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
  };
  const cache = () => { if(T5_BULLE) T5_BULLE.hidden = true; };
  hote.querySelectorAll(".t5s,.t5l").forEach(el=>{
    el.addEventListener("mouseenter", ()=>montre(el));
    el.addEventListener("focus", ()=>montre(el));
    el.addEventListener("mouseleave", cache);
    el.addEventListener("blur", cache);
    el.tabIndex = 0;                                          // accessible au clavier
  });
  hote.addEventListener("mouseleave", cache);
  addEventListener("scroll", cache, { passive:true });
}
function renderDashboard(){
  /* Rien à montrer : on remplace le tableau de bord entier plutôt que
     d'afficher huit cartes à zéro. */
  const vide = !RAW.some(r=>r.isMember);
  const dash = document.getElementById("clanDash");
  let host = document.getElementById("cpVideClan");
  if(vide){
    if(!host){ host=document.createElement("div"); host.id="cpVideClan"; dash.parentNode.insertBefore(host, dash); }
    host.innerHTML = cpVideClan();
    dash.style.display = "none";
    return;
  }
  if(host) host.innerHTML = "";
  dash.style.display = "";
  renderHealth(); renderLast(); renderWg(); renderMini(); renderOfficialCards(); renderTop5(); }

let SELP=null;   // account_id du joueur sélectionné dans "Ma progression"
function populatePlayerSel(){
  const seen={}; RAW.forEach(r=>{ if(r.isMember && r.accId!=null && !seen[r.accId]) seen[r.accId]=r.name; });
  const ids=Object.keys(seen).map(Number).sort((a,b)=>String(seen[a]).localeCompare(String(seen[b])));
  SELP = (ME_ID!=null && seen[ME_ID]) ? Number(ME_ID) : (ids.length?ids[0]:null);
  const sel=document.getElementById("playerSel");
  sel.innerHTML=ids.map(id=>`<option value="${id}" ${id===SELP?"selected":""}>${esc(seen[id])}</option>`).join("");
}
/* La barre de filtres vit SOUS le hero sur la vue clan, en haut ailleurs. */
function placeSubbar(v){
  const sb=document.getElementById("subbar");
  if(v==="clan") document.getElementById("dashSub").appendChild(sb);
  else document.getElementById("loading").before(sb);
}
/* Sections encore en chantier : tout le monde voit le message, seul le mode test
   (?dev) accède au contenu réel. On MASQUE le contenu au lieu de le supprimer,
   pour que le basculement en dev le rétablisse sans recharger la page. */
const WIP_VIEWS={ player:["Ma progression","Le nouveau SR et sa décomposition arrivent bientôt."],
                  ranking:["Classements","Le classement des clans est en cours de refonte."] };
function wipGate(v){
  for(const id in WIP_VIEWS){
    const el=document.getElementById("view"+id.charAt(0).toUpperCase()+id.slice(1));
    if(!el) continue;
    const bloque = !DEV;
    let msg=el.querySelector(":scope > .wip-msg");
    if(bloque && !msg){
      msg=document.createElement("div"); msg.className="wip-msg";
      msg.innerHTML=`<div class="wip-ic">🚧</div><h3>${esc(WIP_VIEWS[id][0])} — en construction</h3>
        <p>${esc(WIP_VIEWS[id][1])}<br>Cette section sera ouverte à tout le clan dès qu'elle sera prête.</p>`;
      el.prepend(msg);
    }
    if(!bloque && msg){ msg.remove(); msg=null; }
    [...el.children].forEach(n=>{ if(n!==msg) n.style.display = bloque ? "none" : ""; });
  }
}
function switchView(v){
  wipGate(v);
  document.querySelectorAll("#nav .tab").forEach(t=>t.classList.toggle("on",t.dataset.v===v));
  document.getElementById("viewClan").classList.toggle("hidden", v!=="clan");
  document.getElementById("viewBattles").classList.toggle("hidden", v!=="battles");
  /* « Ma progression » n'est plus une vue d'ici : c'est progression.html. */
  document.getElementById("viewLineups").classList.toggle("hidden", v!=="lineups");
  document.getElementById("viewLoadouts").classList.toggle("hidden", v!=="loadouts");
  document.getElementById("viewStrats").classList.toggle("hidden", v!=="strats");
  document.getElementById("viewRanking").classList.toggle("hidden", v!=="ranking");
  document.getElementById("viewSearch").classList.toggle("hidden", v!=="search");
  document.getElementById("viewRecruit").classList.toggle("hidden", v!=="recruit");
  document.getElementById("playerPick").classList.toggle("hidden", v!=="player");
  document.getElementById("subbar").classList.toggle("hidden", v!=="clan"&&v!=="player"&&v!=="battles");
  const _s=document.getElementById("search"); if(_s) _s.style.visibility = (v==="clan") ? "visible" : "hidden";
  placeSubbar(v);
  if(v==="battles") renderBattles();
  /* « Ma progression » n'est plus une vue : c'est progression.html. */
  if(v==="lineups") loadLineups();
  if(v==="loadouts") loadLoadouts();
  if(v==="strats") loadStrats();
  if(v==="ranking") loadRanking();
  if(v==="recruit") loadRecruit();
}

/* ============================================================
   VUE RECRUTEMENT  (annonce du clan, façon job board)
   ============================================================ */
const RC_LANGS=[["fr","🇫🇷 Français"],["en","🇬🇧 Anglais"],["de","🇩🇪 Allemand"],["es","🇪🇸 Espagnol"],["it","🇮🇹 Italien"],["pl","🇵🇱 Polonais"],["pt","🇵🇹 Portugais"],["nl","🇳🇱 Néerl."],["tr","🇹🇷 Turc"],["cs","🇨🇿 Tchèque"],["ru","Russe"]];
const RC_ACTS=[["cw","Guerre de clans"],["skirmish","Escarmouches"],["random","Aléatoire"],["tournament","Tournois"],["fun","Détente"]];
let RC_OFFER=null, RC_CANEDIT=false;
async function loadRecruit(){
  const card=document.getElementById("recruitCard");
  card.innerHTML='<h2>Recrutement</h2><p class="sec-desc">Chargement…</p>';
  const r=await fnCall("clan-offers",{session:localStorage.getItem(LS_SESSION),action:"mine"});
  if(!r.ok){ card.innerHTML='<h2>Recrutement</h2><p class="sec-desc">Erreur : '+esc(r.j.error||r.status)+'. La fonction serveur « clan-offers » est-elle déployée&nbsp;?</p>'; return; }
  RC_OFFER=r.j.offer||{}; RC_CANEDIT=!!r.j.canEdit;
  renderRecruit();
}
function renderRecruit(){
  const o=RC_OFFER||{}, card=document.getElementById("recruitCard");
  const langsSel=new Set(o.langs||[]), actsSel=new Set(o.activities||[]);
  const chip=(arr,sel,cls)=>arr.map(([v,lab])=>`<span class="rc-chip ${sel.has(v)?"on":""}" data-${cls}="${v}">${esc(lab)}</span>`).join("");
  card.innerHTML=`
    <h2>Recrutement <span class="hint">l'annonce de ton clan</span></h2>
    <p class="sec-desc" style="margin:-6px 0 14px">Publie une annonce que les joueurs <b>sans clan</b> verront sur la page «&nbsp;Trouver un clan&nbsp;». Une annonce par clan. <a href="trouver-clan.html#offres" target="_blank" rel="noopener" style="color:var(--accent);font-weight:600">Voir la page ↗</a></p>
    ${RC_CANEDIT?"":'<div class="rc-notice">Seuls les <b>officiers</b> du clan peuvent modifier l\'annonce. Tu peux la consulter ci-dessous.</div>'}
    <div class="rc-form ${RC_CANEDIT?"":"rc-disabled"}">
      <label>Titre / accroche
        <input type="text" id="rcTitle" maxlength="90" placeholder="Ex : Clan FR convivial recrute pour le Bastion" value="${esc(o.title||"")}"></label>
      <label>Présentation du clan
        <textarea id="rcPitch" maxlength="1500" placeholder="Ambiance, ce que vous jouez, vos attentes, votre organisation…">${esc(o.pitch||"")}</textarea></label>
      <div class="rc-grid">
        <label>Langues parlées<div class="rc-chips" id="rcLangs">${chip(RC_LANGS,langsSel,"lang")}</div></label>
        <label>Vous jouez surtout<div class="rc-chips" id="rcActs">${chip(RC_ACTS,actsSel,"act")}</div></label>
      </div>
      <div class="rc-grid3">
        <label>WN8 minimum<input type="number" id="rcWn8" min="0" max="99999" placeholder="ex : 1500" value="${o.min_wn8||""}"></label>
        <label>Batailles minimum<input type="number" id="rcBat" min="0" placeholder="ex : 5000" value="${o.min_battles||""}"></label>
        <label>Tier de chars min<input type="number" id="rcTier" min="1" max="10" placeholder="ex : 8" value="${o.min_tier||""}"></label>
      </div>
      <div class="rc-grid">
        <label>Créneaux de jeu<input type="text" id="rcHours" maxlength="80" placeholder="Ex : 20h-23h en semaine" value="${esc(o.play_hours||"")}"></label>
        <label>Contact (Discord ou lien)<input type="text" id="rcContact" maxlength="200" placeholder="https://discord.gg/… ou pseudo" value="${esc(o.contact||"")}"></label>
      </div>
      <div class="rc-actions">
        <label class="rc-status"><input type="checkbox" id="rcActive" ${o.status!=="paused"?"checked":""}> Annonce publiée (visible par les joueurs)</label>
        <div style="margin-left:auto;display:flex;gap:8px">
          ${(o.clan_id||o._saved)?'<button class="btn" id="rcDelete">Supprimer</button>':""}
          <button class="btn primary" id="rcSave">Enregistrer</button>
        </div>
      </div>
      <div class="rc-msg" id="rcMsg"></div>
    </div>`;
  card.querySelectorAll(".rc-chip").forEach(c=>c.onclick=()=>{ if(RC_CANEDIT) c.classList.toggle("on"); });
  if(RC_CANEDIT){
    document.getElementById("rcSave").onclick=saveRecruit;
    const del=document.getElementById("rcDelete"); if(del) del.onclick=deleteRecruit;
  }
}
function collectRecruit(){
  const langs=[...document.querySelectorAll("#rcLangs .rc-chip.on")].map(c=>c.dataset.lang);
  const activities=[...document.querySelectorAll("#rcActs .rc-chip.on")].map(c=>c.dataset.act);
  const num=id=>{const v=parseInt(document.getElementById(id).value,10);return Number.isFinite(v)&&v>0?v:null;};
  return { title:document.getElementById("rcTitle").value.trim(), pitch:document.getElementById("rcPitch").value.trim(),
    langs, activities, play_hours:document.getElementById("rcHours").value.trim(),
    min_wn8:num("rcWn8"), min_battles:num("rcBat"), min_tier:num("rcTier"),
    contact:document.getElementById("rcContact").value.trim(),
    status:document.getElementById("rcActive").checked?"active":"paused" };
}
async function saveRecruit(){
  const msg=document.getElementById("rcMsg"); msg.className="rc-msg"; msg.textContent="Enregistrement…";
  const offer=collectRecruit();
  const r=await fnCall("clan-offers",{session:localStorage.getItem(LS_SESSION),action:"save",offer});
  if(r.ok&&r.j.ok){ msg.className="rc-msg ok"; msg.textContent=offer.status==="paused"?"✓ Enregistrée (en pause — non visible).":"✓ Annonce publiée — visible sur « Trouver un clan »."; RC_OFFER=Object.assign({},RC_OFFER||{},offer,{_saved:true}); }
  else { msg.className="rc-msg err"; msg.textContent="Erreur : "+esc(r.j.error||r.status); }
}
async function deleteRecruit(){
  if(!confirm("Supprimer l'annonce de recrutement de ton clan ?"))return;
  const msg=document.getElementById("rcMsg"); msg.className="rc-msg"; msg.textContent="Suppression…";
  const r=await fnCall("clan-offers",{session:localStorage.getItem(LS_SESSION),action:"delete"});
  if(r.ok&&r.j.ok){ RC_OFFER={}; renderRecruit(); }
  else { msg.className="rc-msg err"; msg.textContent="Erreur : "+esc(r.j.error||r.status); }
}

/* ============================================================
   VUE BATAILLES  (confrontations façon "affiche de match")
   ============================================================ */
function ourEmblemUrl(){
  const e = CLANINFO && CLANINFO.emblems;
  return (e && ((e.x64&&(e.x64.wot||e.x64.portal)) || (e.x32&&e.x32.portal))) || "";
}
function emblemHTML(tag, url, cls){
  if(url) return `<img class="bl-em ${cls}" src="${esc(url)}" alt="${esc(tag||'')}" loading="lazy">`;
  const ini = String(tag||"?").replace(/[^A-Za-z0-9]/g,"").slice(0,4) || "?";
  return `<span class="bl-em bl-em-ph ${cls}">${esc(ini)}</span>`;
}
// Emblèmes adverses : résolus par tag via clan-lookup, mis en cache (localStorage).
let EMBLEM_CACHE=(()=>{ try{ return JSON.parse(localStorage.getItem("cp_emblems")||"{}"); }catch(e){ return {}; } })();
function emblemFoeHTML(tag, sizeClass){
  sizeClass=sizeClass||"bl-em";
  const url=EMBLEM_CACHE[tag];
  if(url) return `<img class="${sizeClass} foe" src="${esc(url)}" alt="${esc(tag||'')}">`;
  const ini=String(tag||"?").replace(/[^A-Za-z0-9]/g,"").slice(0,4)||"?";
  return `<span class="${sizeClass} bl-em-ph foe" data-foe-tag="${esc(tag||'')}">${esc(ini)}</span>`;
}
function emblemOursHTML(sizeClass){
  sizeClass=sizeClass||"bl-em";
  const url=ourEmblemUrl();
  if(url) return `<img class="${sizeClass} ours" src="${esc(url)}" alt="${esc(CLANTAG||'')}">`;
  const ini=String(CLANTAG||"?").replace(/[^A-Za-z0-9]/g,"").slice(0,4)||"?";
  return `<span class="${sizeClass} bl-em-ph ours">${esc(ini)}</span>`;
}
async function resolveEnemyEmblems(list){
  const tags=[...new Set(list.map(g=>g.enemyTag).filter(t=>t&&t!=="?"))].filter(t=>!(t in EMBLEM_CACHE));
  for(const tag of tags){
    let url="";
    try{
      const r=await fnCall("clan-lookup",{session:localStorage.getItem(LS_SESSION),query:tag});
      if(r.ok && Array.isArray(r.j.results)){
        const m=r.j.results.find(c=>String(c.tag||"").toUpperCase()===tag.toUpperCase())||r.j.results[0];
        if(m&&m.emblems) url=(m.emblems.x64&&(m.emblems.x64.wot||m.emblems.x64.portal))||(m.emblems.x32&&m.emblems.x32.portal)||"";
      }
    }catch(e){}
    EMBLEM_CACHE[tag]=url;   // on cache même vide, pour ne pas re-demander
    try{ localStorage.setItem("cp_emblems",JSON.stringify(EMBLEM_CACHE)); }catch(e){}
    if(url) document.querySelectorAll("[data-foe-tag]").forEach(el=>{
      if(el.getAttribute("data-foe-tag")===tag){
        const img=document.createElement("img");
        img.className=el.className.replace("bl-em-ph","").replace(/\s+/g," ").trim();   // garde la taille
        img.src=url; img.alt=tag;
        el.replaceWith(img);
      }
    });
  }
}
const MODE_FR={SORTIE_2:"Bastion",SORTIE:"Bastion",FORT_BATTLE_2:"Bastion",FORT_BATTLE:"Bastion",EPIC_BATTLE:"Assaut"};
function modeFR(m){ return MODE_FR[m] || (m?capFirst(String(m).toLowerCase().replace(/_/g," ")):"Bastion"); }
function cleanMap(s){
  s=String(s||"").replace(/^\d+[_\-\s]*/,"").replace(/[_\-]+/g," ").trim();
  return s?s.replace(/\b\w/g,c=>c.toUpperCase()):"Carte ?";
}
function mapKey(name){ return String(name||"").toLowerCase().replace(/[^a-z]/g,""); }
function mapBgHTML(name){
  const k=mapKey(name);
  const img=k?`<img src="maps/${k}.jpg" alt="" onerror="this.style.display='none'">`:"";
  return `<div class="bl-bg">${img}<div class="sh"></div></div>`;
}
function mapInfoHTML(name,mode){
  return `<div class="bl-mapinfo"><div class="nm">${esc(cleanMap(name))}</div><div class="md">${esc(modeFR(mode))}</div></div>`;
}
function srPill(v){ const t=ceTier(v);
  return `<div class="bl-sr" style="border-color:${t.c};color:${t.c}" title="Synergy Rating — ${esc(t.l)}"><span class="lbl">SR</span><span class="val">${v==null?"—":fmt(v)}</span></div>`; }
function agoFR(ts){
  if(!ts) return "";
  const s=Math.max(1,Math.floor(Date.now()/1000-ts));
  if(s<3600) return "il y a "+Math.floor(s/60)+" min";
  if(s<86400){ const h=Math.floor(s/3600); return "il y a "+h+" h"; }
  const j=Math.floor(s/86400); return "il y a "+j+" j";
}
function durFR(s){ s=Math.round(s||0); return Math.floor(s/60)+":"+String(s%60).padStart(2,"0"); }
function shortName(n){ n=String(n||""); return n.length>14?n.slice(0,13)+"…":n; }
function capFirst(s){ s=String(s||""); return s?s.charAt(0).toUpperCase()+s.slice(1):s; }

function groupBattles(){
  const now=Date.now()/1000;
  const map={};
  RAW.forEach(r=>{
    if(state.mode && r.mode!==state.mode) return;
    if(state.days && r.ts && (now-r.ts)>state.days*86400) return;
    let g=map[r.battleId];
    if(!g){ g=map[r.battleId]={id:r.battleId, ts:r.ts||0, mode:r.mode, result:r.result, mapName:r.mapName, rows:[]}; }
    g.rows.push(r);
  });
  const tagU=CLANTAG.toUpperCase();
  const mine=r=>r.isMember || (r.clan && r.clan.toUpperCase()===tagU);
  const list=Object.values(map).map(g=>{
    // notre équipe = celle qui compte le PLUS de joueurs du clan (robuste aux équipes mixtes)
    const teams=[...new Set(g.rows.map(r=>r.team))];
    let ourTeam=teams[0], bestN=-1;
    teams.forEach(t=>{ const n=g.rows.filter(r=>r.team===t && mine(r)).length; if(n>bestN){ bestN=n; ourTeam=t; } });
    g.our = g.rows.filter(r=>r.team===ourTeam);
    g.foe = g.rows.filter(r=>r.team!==ourTeam);
    if(!g.our.length){ g.our=g.rows; g.foe=[]; }         // sécurité
    g.ourScore = g.foe.filter(r=>!r.surv).length;         // ennemis détruits
    g.foeScore = g.our.filter(r=>!r.surv).length;         // alliés détruits
    g.enemyTag = BATTLE_ENEMY[g.id] || (g.foe[0]&&g.foe[0].clan) || "?";
    // MVP retiré : désigner un « meilleur joueur » sur les seuls dégâts
    // récompensait le char qui tire, jamais celui qui éclaire ou qui
    // encaisse. L'impact décomposé du tableau de bord répond mieux à la
    // question, et le détail de la bataille donne déjà toutes les lignes.
    // CÉ de la bataille = moyenne des CÉ des membres présents
    const mem=g.our.filter(mine);
    g.ce = srAvg(mem);
    g.win = g.result===1; g.draw = g.result===-1;
    g.dur = g.rows.reduce((mx,r)=>Math.max(mx,r.life||0),0);
    return g;
  });
  list.sort((a,b)=>b.ts-a.ts);
  return list;
}
function blTeam(rows, ours, tag, url){
  const sorted=rows.slice().sort((a,b)=>b.dmg-a.dmg);
  const em = ours ? emblemHTML(tag,url,'ours') : emblemFoeHTML(tag);
  const dmgTot = sorted.reduce((s,r)=>s+(r.dmg||0),0);
  const head=`<div class="hd">${em} ${ours?'Notre équipe':'Adversaire'} — [${esc(tag)}]<span class="sub">${fmt(dmgTot)} dég.</span></div>`;
  const ceH = ours?`<th class="c">SR</th>`:``;
  const body=sorted.map(r=>{
    let ceCell="";
    if(ours) ceCell = r.isMember ? `<td class="c">${ceBadge((function(){const v=srBattle(r); return v==null?null:Math.round(v);})())}</td>` : `<td class="c" style="color:var(--muted)">—</td>`;
    return `<tr class="${r.isMember?'me':''}">
      <td>${esc(r.tank||'?')}</td><td>${esc(shortName(r.name))}</td>
      <td>${fmt(r.dmg)}</td><td>${r.kills}</td><td>${fmt(r.assist)}</td><td>${fmt(r.block)}</td>
      <td class="c">${r.surv?'<span class="bl-alive" title="survivant">●</span>':'<span class="bl-dead" title="détruit">✖</span>'}</td>${ceCell}</tr>`;
  }).join("");
  return `<div class="bl-team-card ${ours?'ours':'foe'}">${head}<div class="tw"><table class="bl-tbl"><thead><tr><th>Char</th><th>Joueur</th><th>Dég.</th><th>Frags</th><th>Assist</th><th>Bloc.</th><th class="c">Survie</th>${ceH}</tr></thead><tbody>${body}</tbody></table></div></div>`;
}
function blRowHTML(g){
  const cls=g.win?"bl-win":(g.draw?"bl-draw":"bl-loss");
  const rz=g.win?"Victoire":(g.draw?"Match nul":"Défaite");
  const sr=g.ce!=null?srPill(g.ce):"";
  return `<div class="bl-row ${cls}" data-bid="${esc(String(g.id))}">
    <div class="bl-head" onclick="this.parentNode.classList.toggle('open')">
      ${mapBgHTML(g.mapName)}
      ${mapInfoHTML(g.mapName,g.mode)}
      <div class="bl-match">
        <div class="bl-team left"><span class="tag">[${esc(CLANTAG)}]</span>${emblemOursHTML('bl-emblem')}</div>
        <div class="bl-scorebox"><div class="sc"><span class="a">${g.ourScore}</span><span class="bl-sep">:</span><span>${g.foeScore}</span></div><div class="rz">${rz}</div><span class="bl-dom" role="img" aria-label="${g.ourScore} chars adverses détruits, ${g.foeScore} des nôtres"><i style="width:${(g.ourScore+g.foeScore)?Math.round(g.ourScore/(g.ourScore+g.foeScore)*100):50}%"></i></span></div>
        <div class="bl-team right">${emblemFoeHTML(g.enemyTag,'bl-emblem')}<span class="tag">[${esc(g.enemyTag)}]</span></div>
      </div>
      <div class="bl-right">
        ${sr}
        <div class="bl-metar"><div>${agoFR(g.ts)} · ${durFR(g.dur)}</div></div>
        <span class="bl-chev">▾</span>
      </div>
    </div>
    <div class="bl-detail"><div class="bl-din">
      <div class="bl-tabs">
        <button class="bl-tab on" type="button" data-bt="res" onclick="event.stopPropagation();blTab(this,'res','${g.id}')"><span class="bl-tab-ic">▤</span> Résultat</button>
        <button class="bl-tab" type="button" data-bt="rep" onclick="event.stopPropagation();blTab(this,'rep','${g.id}')"><span class="bl-tab-ic">▶</span> Replay</button>
      </div>
      <div class="bl-pane" data-pane="res"><div class="bl-teams">${blTeam(g.our,true,CLANTAG,ourEmblemUrl())}${blTeam(g.foe,false,g.enemyTag,'')}</div></div>
      <div class="bl-pane" data-pane="rep" hidden><div class="rp-host"></div></div>
    </div></div>
  </div>`;
}
function blSummaryHTML(list){
  const n=list.length, wins=list.filter(g=>g.win).length;
  let dmgSum=0,dmgN=0,survSum=0,srSum=0,srN=0;
  list.forEach(g=>{ g.our.forEach(r=>{dmgSum+=r.dmg;dmgN++;}); survSum+=g.our.filter(r=>r.surv).length;
    if(g.ce!=null){srSum+=g.ce;srN++;} });
  const wr=n?Math.round(wins/n*100):0, dmgAvg=dmgN?Math.round(dmgSum/dmgN):0, survAvg=n?survSum/n:0;
  const srMoy=srN?Math.round(srSum/srN):null, srCol=srMoy!=null?ceTier(srMoy).c:"var(--ink)";

  /* ── Les adversaires : ce que SEUL cet onglet peut raconter. La Vue
     clan donne déjà le taux de victoire ; elle ne dit jamais contre qui. ── */
  const par={};
  list.forEach(g=>{ const t=g.enemyTag||"?"; if(t==="?") return;
    const a=par[t]=par[t]||{tag:t,n:0,v:0}; a.n++; if(g.win) a.v++; });
  const adv=Object.values(par).sort((a,b)=>b.n-a.n);
  const habitues=adv.slice(0,5);
  const durs=adv.filter(a=>a.n>=3).sort((a,b)=>(a.v/a.n)-(b.v/b.n));
  const noire=durs[0], facile=durs[durs.length-1];

  let titre, ph;
  if(!n){ titre="Aucune confrontation"; ph="Aucune bataille sur cette période."; }
  else{
    titre = wr>=60?"On tient le terrain." : (wr>=50?"Jeu égal." : "Ça résiste en face.");
    ph = "<b>"+fmt(n)+"</b> confrontation"+(n>1?"s":"")+", <b>"+wins+"</b> gagnée"+(wins>1?"s":"")+".";
    if(adv.length) ph += " <b>"+fmt(adv.length)+"</b> clan"+(adv.length>1?"s":"")+" affronté"+(adv.length>1?"s":"")+".";
    if(noire && noire.v/noire.n < .5)
      ph += ' <span class="who">['+esc(noire.tag)+']</span> est celui qui te résiste le plus — <b>'+
            noire.v+"</b> victoire"+(noire.v>1?"s":"")+" en <b>"+noire.n+"</b> rencontres.";
    else if(facile && facile.n>=3)
      ph += ' Ton meilleur bilan est contre <span class="who">['+esc(facile.tag)+
            ']</span> : <b>'+facile.v+"</b> sur <b>"+facile.n+"</b>.";
  }

  const barres = habitues.map((a,i)=>{
    const p=Math.round(a.v/a.n*100);
    return '<div class="bl-adv" style="--i:'+i+'" title="['+esc(a.tag)+'] — '+a.v+' victoire'+(a.v>1?"s":"")+' sur '+a.n+' rencontres">'+
      '<span class="t">['+esc(a.tag)+']</span>'+
      '<span class="b"><i style="width:'+p+'%"></i></span>'+
      '<span class="c">'+a.v+'<span class="s">/'+a.n+'</span></span></div>';
  }).join("");

  return '<section class="bl-verdict">'+
      '<div class="bl-vg"><h2 class="bl-vt">'+titre+'</h2><p class="bl-vp">'+ph+'</p></div>'+
      '<div class="bl-vn"><b data-n="'+wr+'">'+wr+' %</b><i>de victoires</i></div>'+
      (habitues.length?'<div class="bl-advs"><div class="bl-advt">Adversaires les plus fréquents</div>'+barres+'</div>':"")+
    '</section>'+
    '<div class="bl-mes">'+
      '<div class="bl-sc"><div class="l">Batailles</div><div class="v">'+fmt(n)+'</div></div>'+
      '<div class="bl-sc"><div class="l">SR moyen du clan</div><div class="v" style="color:'+srCol+'">'+(srMoy!=null?fmt(srMoy):"—")+'</div></div>'+
      '<div class="bl-sc"><div class="l">Dégâts moy./joueur</div><div class="v">'+fmt(dmgAvg)+'</div></div>'+
      '<div class="bl-sc"><div class="l">Alliés survivants moy.</div><div class="v">'+survAvg.toFixed(1)+'<span class="u">/7</span></div></div>'+
    '</div>';
}
let BL_PAGE=0; const BL_PER_PAGE=50;
function renderBattles(){
  const list=groupBattles();
  const sum=document.getElementById("blSummary"), wrap=document.getElementById("blList"), pg=document.getElementById("blPager");
  if(!list.length){
    sum.innerHTML="";
    /* Distinguer « le clan n'a rien » de « rien sur CETTE période » :
       le premier appelle la marche à suivre, le second un simple filtre
       à élargir. */
    const jamais = !RAW.some(r=>r.isMember);
    wrap.innerHTML = jamais ? cpVideClan()
      : cpVide("🔍","Aucune bataille sur cette période",
          "Élargis la période avec les boutons <b>7 j / 30 j / 90 j / Tout</b> en haut, "+
          "ou change de mode.", null, "");
    pg.innerHTML=""; return; }
  BL_BY_ID={}; list.forEach(g=>{ BL_BY_ID[g.id]=g; });
  sum.innerHTML=blSummaryHTML(list);
  { const nb=sum.querySelector(".bl-vn b");
    if(nb && typeof animateNum==="function" && !REDUCE_MOTION)
      animateNum(nb, +nb.dataset.n, v=>Math.round(v)+" %"); }
  const pages=Math.ceil(list.length/BL_PER_PAGE);
  if(BL_PAGE>=pages) BL_PAGE=0;
  const slice=list.slice(BL_PAGE*BL_PER_PAGE,(BL_PAGE+1)*BL_PER_PAGE);
  wrap.innerHTML=slice.map(blRowHTML).join("");
  renderBlPager(list.length,pages);
  resolveEnemyEmblems(slice);   // récupère les logos adverses en arrière-plan (page courante)
}
function renderBlPager(total,pages){
  const pg=document.getElementById("blPager"); if(!pg) return;
  if(pages<=1){ pg.innerHTML=`<span class="bl-pg-info">${fmt(total)} bataille${total>1?"s":""}</span>`; return; }
  const cur=BL_PAGE, win=[];
  for(let i=0;i<pages;i++){
    if(i===0||i===pages-1||Math.abs(i-cur)<=2) win.push(i);
    else if(win[win.length-1]!=="…") win.push("…");
  }
  const btns=win.map(p=> p==="…" ? '<span class="bl-pg-dot">…</span>' : `<button class="bl-pg${p===cur?" on":""}" data-p="${p}">${p+1}</button>`).join("");
  pg.innerHTML=`<button class="bl-pg bl-pg-nav" data-p="${cur-1}" ${cur===0?"disabled":""}>‹</button>${btns}<button class="bl-pg bl-pg-nav" data-p="${cur+1}" ${cur===pages-1?"disabled":""}>›</button><span class="bl-pg-info">${fmt(total)} batailles · page ${cur+1}/${pages}</span>`;
  pg.querySelectorAll("button.bl-pg").forEach(b=>{ if(b.disabled) return; b.onclick=()=>{
    const p=parseInt(b.dataset.p,10); if(p>=0&&p<pages){ BL_PAGE=p; renderBattles();
      const t=document.getElementById("viewBattles"); if(t) window.scrollTo(0,0); }
  }; });
}

/* ============================================================
   LECTEUR DE REPLAY (phase 3) — mini-carte animée + curseur.
   Données attendues : { bounds:{minX,minZ,maxX,maxZ}, duration,
   vehicles:[{id, ally, member, name, tank, deathT, track:[[t,x,z],…]}] }
   Pour l'instant alimenté par mockReplay() (positions simulées) en attendant
   que le mod envoie les vraies positions (phase 2).
   ============================================================ */
let BL_BY_ID={};
/* --- icônes de classe (silhouettes 48×48) : chargées une fois, puis
   colorées par équipe et mises en cache pour le dessin sur la carte --- */
const RP_CLASSES=["heavyTank","mediumTank","lightTank","AT-SPG","SPG"];
const RP_ICON={}, RP_TINT={};
/* Drapeaux de base : sprites d'origine du jeu (extraits de battleAtlas)
   — vert = notre base, rouge = base adverse, neutre = base blanche (7v7). */
const RP_BASES=["green","red","neutral"];
const RP_BASE_IMG={};
let RP_ICONS_READY=false;
function rpLoadIcons(onReady){
  if(RP_ICONS_READY) return;
  let left=RP_CLASSES.length+RP_BASES.length;
  const done=()=>{ if(--left<=0){ RP_ICONS_READY=true; onReady&&onReady(); } };
  RP_CLASSES.forEach(c=>{
    const im=new Image();
    im.onload=()=>{ RP_ICON[c]=im; done(); };
    im.onerror=done;
    im.src="classes/"+encodeURIComponent(c)+".png";
  });
  RP_BASES.forEach(b=>{
    const im=new Image();
    im.onload=()=>{ RP_BASE_IMG[b]=im; done(); };
    im.onerror=done;
    im.src="bases/"+b+".png";
  });
}
/* Boîte utile de l'icône (les PNG ont de larges marges et des tailles de glyphe
   inégales) : on recadre pour que toutes les classes aient le même poids visuel. */
const RP_BBOX={};
function rpBBox(cls){
  if(RP_BBOX[cls]) return RP_BBOX[cls];
  const im=RP_ICON[cls]; if(!im) return null;
  const w=im.naturalWidth||48, h=im.naturalHeight||48;
  const c=document.createElement("canvas"); c.width=w; c.height=h;
  const x=c.getContext("2d"); x.drawImage(im,0,0);
  let d; try{ d=x.getImageData(0,0,w,h).data; }catch(e){ return null; }
  let minX=w, minY=h, maxX=-1, maxY=-1;
  for(let y=0;y<h;y++) for(let px=0;px<w;px++){
    if(d[(y*w+px)*4+3]>25){ if(px<minX)minX=px; if(px>maxX)maxX=px; if(y<minY)minY=y; if(y>maxY)maxY=y; }
  }
  if(maxX<0) return null;
  return (RP_BBOX[cls]={x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1});
}
/* Renvoie un canvas de l'icône `cls` teintée en `color`, tenant dans `size` px. */
function rpTinted(cls, color, size){
  const key=cls+"|"+color+"|"+size;
  if(RP_TINT[key]) return RP_TINT[key];
  const im=RP_ICON[cls]; if(!im) return null;
  const bb=rpBBox(cls);
  const c=document.createElement("canvas"); c.width=c.height=size;
  const x=c.getContext("2d");
  if(bb){ // recadré et centré, proportions conservées
    const k=Math.min(size/bb.w, size/bb.h), dw=bb.w*k, dh=bb.h*k;
    x.drawImage(im, bb.x, bb.y, bb.w, bb.h, (size-dw)/2, (size-dh)/2, dw, dh);
  } else x.drawImage(im,0,0,size,size);
  x.globalCompositeOperation="source-in";       // ne garde que la silhouette
  x.fillStyle=color; x.fillRect(0,0,size,size);
  RP_TINT[key]=c; return c;
}
function convertReplay(raw){
  const b=raw.bounds||[-500,-500,500,500], my=raw.myTeam;
  const vehicles=(raw.vehicles||[]).map(v=>({
    id: (v.id!=null? Number(v.id) : null),
    ally: v.team===my,
    member: !!(v.acc && MEMBERSET.has(Number(v.acc))),
    name: v.name||"", tank: v.tank||"",
    cls: (RP_CLASSES.indexOf(v.cls)>=0 ? v.cls : ""),
    maxHp: Number(v.hp||0),
    deathT: (v.death!=null? v.death : null),
    track: v.track||[],
  }));
  const byId={}; vehicles.forEach(v=>{ if(v.id!=null) byId[v.id]=v; });
  const posOf=(v,t)=>{ const tr=v&&v.track; if(!tr||!tr.length) return null;
    let lo=tr[0];
    for(let i=0;i<tr.length;i++){ if(tr[i][0]<=t) lo=tr[i];
      else { const hi=tr[i], f=(t-lo[0])/((hi[0]-lo[0])||1);
             return {x:lo[1]+(hi[1]-lo[1])*f, z:lo[2]+(hi[2]-lo[2])*f}; } }
    return {x:lo[1], z:lo[2]}; };
  // Événements du mod (v2) : morts, dégâts, tirs
  const shots=[], kills=[], damage=[], dmgBy={};
  (raw.events||[]).forEach(e=>{
    if(!e||!e.length) return;
    const k=e[0], t=Number(e[1])||0;
    if(k==="s"){
      const sh=byId[Number(e[2])];
      let x=e[3], z=e[4];
      if(x==null||z==null){ const p=posOf(sh,t); if(!p) return; x=p.x; z=p.z; }
      shots.push({t, x:Number(x), z:Number(z), ally: sh? sh.ally : false});
    } else if(k==="k"){
      const vic=byId[Number(e[2])], kil=byId[Number(e[3])];
      kills.push({t, victim:Number(e[2]), killer:Number(e[3]),
                  victimName: vic? vic.name : "?", killerName: kil? kil.name : "",
                  victimAlly: vic? vic.ally : false});
      if(vic && (vic.deathT==null || t<vic.deathT)) vic.deathT=t;
    } else if(k==="d"){
      const dmg=Number(e[4])||0;
      damage.push({t, victim:Number(e[2]), attacker:Number(e[3]), dmg});
      if(e[3]) dmgBy[Number(e[3])]=(dmgBy[Number(e[3])]||0)+dmg;
    }
  });
  kills.sort((a,b)=>a.t-b.t);
  damage.sort((a,b)=>a.t-b.t);
  // Points de vie au fil du temps : PV max moins les dégâts encaissés jusqu'à t.
  vehicles.forEach(v=>{ v.hits=[]; });
  damage.forEach(d=>{ const v=byId[d.victim]; if(v) v.hits.push([d.t, d.dmg]); });
  vehicles.forEach(v=>v.hits.sort((a,b)=>a[0]-b[0]));
  // équipe 0 = base NEUTRE (blanche, 7v7 / Rencontre)
  const bases=(raw.bases||[]).map(bs=>({
    team:(Number(bs[0])===0 ? "neutral" : (bs[0]===my ? "ally" : "enemy")),
    x:bs[1], z:bs[2], r:70 }));
  return { bounds:{minX:b[0],minZ:b[1],maxX:b[2],maxZ:b[3]}, duration:raw.duration||0,
           interval: Number(raw.interval)||2,
           bases, vehicles, byId, shots, kills, damage, dmgBy };
}
/* Bascule Résultat / Replay dans une carte de bataille dépliée.
   Le replay n'est chargé qu'au premier affichage de son onglet. */
function blTab(btn, which, id){
  const detail=btn.closest(".bl-detail"); if(!detail) return;
  detail.querySelectorAll(".bl-tab").forEach(b=>b.classList.toggle("on", b.dataset.bt===which));
  detail.querySelectorAll(".bl-pane").forEach(p=>{ p.hidden = (p.dataset.pane!==which); });
  if(which==="rep"){
    const host=detail.querySelector(".rp-host");
    if(host && !host.dataset.loaded){ host.dataset.loaded="1"; startReplay(id, host); }
  }
}
async function startReplay(id, host){
  const g=BL_BY_ID[id]; if(!g) return;
  host.innerHTML=cpLoader("Chargement du replay…");
  let rep=null, demo=false;
  try{
    const r=await fnCall("replay",{session:localStorage.getItem(LS_SESSION), battle_id:g.id});
    if(r.ok && r.j && r.j.replay && (r.j.replay.vehicles||[]).length) rep=convertReplay(r.j.replay);
  }catch(e){}
  if(!rep){ rep=mockReplay(g); demo=true; }
  rep.battleId=String(g.id);
  renderReplay(host, rep, mapKey(g.mapName), demo);
}
function mockReplay(g){
  const B={minX:-500,minZ:-500,maxX:500,maxZ:500};
  const dur=Math.max(150, Math.min(600, g.dur||300));
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function track(spawn, deathT){
    const pts=[];
    const tx=clamp(spawn.x+(Math.random()*500-250), B.minX+40, B.maxX-40);
    const tz=clamp(spawn.z*0.15+(Math.random()*260-130), B.minZ+40, B.maxZ-40);
    const N=Math.ceil(dur/4);
    for(let i=0;i<=N;i++){ const t=i*4; if(deathT!=null && t>deathT+4) break;
      const f=Math.min(1,t/(dur*0.65));
      const x=clamp(spawn.x+(tx-spawn.x)*f+(Math.random()*44-22), B.minX, B.maxX);
      const z=clamp(spawn.z+(tz-spawn.z)*f+(Math.random()*44-22), B.minZ, B.maxZ);
      pts.push([t, Math.round(x), Math.round(z)]);
    }
    return pts;
  }
  const veh=[];
  const side=(rows, ally)=>rows.forEach((r,i)=>{
    const n=rows.length||1, spread=(i-(n-1)/2)*130;
    const spawn=ally?{x:spread,z:-430}:{x:spread,z:430};
    const deathT=r.surv?null:(r.life>0?Math.min(r.life,dur):Math.round(50+Math.random()*(dur-80)));
    veh.push({id:(ally?"a":"e")+i, ally, member:!!r.isMember, name:r.name, tank:r.tank, deathT, track:track(spawn,deathT)});
  });
  side(g.our,true); side(g.foe,false);
  // bases de capture (une par équipe)
  const bases=[{team:"ally",x:0,z:-430,r:70},{team:"enemy",x:0,z:430,r:70}];
  // événements de tir simulés : proche d'un char vivant, à un instant donné
  const sampleTrack=(tr,tt)=>{ let lo=tr[0]; for(const p of tr){ if(p[0]<=tt) lo=p; else break; } return lo; };
  const shots=[];
  for(let i=0;i<45;i++){
    const tt=Math.round(10+Math.random()*(dur-20));
    const v=veh[Math.floor(Math.random()*veh.length)];
    if(v.deathT!=null && tt>v.deathT) continue;
    const p=sampleTrack(v.track,tt);
    shots.push({t:tt, x:p[1]+Math.round(Math.random()*50-25), z:p[2]+Math.round(Math.random()*50-25)});
  }
  return {bounds:B, duration:dur, bases, vehicles:veh, shots};
}
function renderReplay(host, rep, mkey, demo){
  const B=rep.bounds, W=1000, K=W/700, spanX=(B.maxX-B.minX)||1, spanZ=(B.maxZ-B.minZ)||1;
  const wx=x=>(x-B.minX)/spanX*W, wy=z=>(B.maxZ-z)/spanZ*W;
  // Couleurs lues sur le système de design du site (elles suivent le thème)
  const _cssv=getComputedStyle(document.documentElement);
  const tok=(n,d)=>((_cssv.getPropertyValue(n)||"").trim()||d);
  const ALLY=tok("--good","#2ec26e"), ENEMY=tok("--bad","#ec6a6a"), GOLD=tok("--accent","#d8b566");
  const SHOT=tok("--accent-2","#ecd190"), INK=tok("--ink","#f6f5f1"), PLANE=tok("--plane","#0c0c0b");
  const DMG="#ffb060";   // trait de dégâts : orange chaud, distinct des couleurs d'équipe
  const esc2=s=>esc(String(s==null?"":s));
  const fmtT=s=>{ s=Math.max(0,Math.floor(s)); return Math.floor(s/60)+":"+String(s%60).padStart(2,"0"); };
  const kills=rep.kills||[], dmgEvents=rep.damage||[], shots=rep.shots||[];

  // ---- Journal : tous les événements de la bataille, dans l'ordre ----
  const nameOf=id=>{ const v=rep.byId[id]; return v ? (v.name||"?") : "?"; };
  const sideOf=id=>{ const v=rep.byId[id]; return v && v.ally ? "A" : "E"; };
  const journal=[];
  kills.forEach(k=>journal.push({t:k.t, cls:"k", ic:"✕",
    html:`<b class="${k.killer?sideOf(k.killer):"E"}">${esc2(k.killerName||"?")}</b> détruit <b class="${sideOf(k.victim)}">${esc2(k.victimName)}</b>`}));
  dmgEvents.forEach(d=>journal.push({t:d.t, cls:"d", ic:"•",
    html:`<b class="${d.attacker?sideOf(d.attacker):"E"}">${esc2(nameOf(d.attacker))}</b> → <b class="${sideOf(d.victim)}">${esc2(nameOf(d.victim))}</b> <i class="jv">${fmt(d.dmg)}</i>`}));
  journal.sort((a,b)=>a.t-b.t);
  const hasSide=journal.length>0;

  // Points de vie restants à l'instant t (PV max moins les dégâts encaissés)
  function hpAt(v,time){
    if(!v.maxHp) return null;          // PV max inconnus (ancien replay) -> pas d'anneau
    let lost=0;
    const h=v.hits||[];
    for(let i=0;i<h.length;i++){ if(h[i][0]<=time) lost+=h[i][1]; else break; }
    return Math.max(0, v.maxHp-lost);  // char intact -> anneau plein
  }
  host.innerHTML=`<div class="rp-wrap">
    <div class="rp-main${hasSide?"":" no-side"}">
      <div>
        <div class="rp-stage"><img src="maps/top/${mkey}.jpg" alt="" onerror="this.style.opacity='.12'"><canvas width="${W}" height="${W}"></canvas><div class="rp-tip"></div></div>
        <div class="rp-ctrl">
          <button class="rp-play" type="button" aria-label="Lecture/pause">❚❚</button>
          <button class="rp-step" type="button" data-step="-5" aria-label="Reculer de 5 s">⏴</button>
          <button class="rp-step" type="button" data-step="5" aria-label="Avancer de 5 s">⏵</button>
          <input class="rp-scrub" type="range" min="0" max="${rep.duration}" step="0.1" value="0">
          <select class="rp-speed" aria-label="Vitesse"><option value="1">×1</option><option value="2" selected>×2</option><option value="4">×4</option><option value="8">×8</option></select>
          <span class="rp-time">0:00 / ${durFR(rep.duration)}</span>
        </div>
        ${demo?`<div class="rp-note">Démo — positions simulées (le mod enverra bientôt les vraies).</div>`
              :`<div class="rp-note"><button class="rp-launch" type="button" onclick="event.stopPropagation();stOpenReplay('${rep.battleId||""}',this)">✎ Débriefer dans l'éditeur</button></div>`}
      </div>
      ${hasSide?`<div class="rp-side">
        <div class="rp-card rp-jcard">
          <h4>Journal <span class="rp-jn"></span></h4>
          <div class="rp-log"></div>
        </div>
      </div>`:""}
    </div></div>`;

  const cv=host.querySelector("canvas"), ctx=cv.getContext("2d");
  const scrub=host.querySelector(".rp-scrub"), playBtn=host.querySelector(".rp-play"), timeEl=host.querySelector(".rp-time");
  const speedSel=host.querySelector(".rp-speed"), tip=host.querySelector(".rp-tip");
  const logEl=host.querySelector(".rp-log"), jnEl=host.querySelector(".rp-jn");
  if(logEl) logEl.innerHTML=journal.map(e=>
    `<div class="${e.cls}"><span class="jt">${fmtT(e.t)}</span><span class="ji">${e.ic}</span><span class="jm">${e.html}</span></div>`).join("");
  let t=0, playing=true, last=performance.now(), speed=2, hover=null, mouse=null;

  /* Un char n'est enregistré que lorsque le jeu transmet sa position, c'est-à-dire
     quand il est REPÉRÉ (les alliés le sont en permanence). Les trous dans la trace
     = moments sans repérage. On renvoie donc aussi l'état de repérage :
       null            -> jamais repéré jusqu'ici (ne rien dessiner)
       spotted:true    -> repéré en ce moment
       spotted:false   -> plus repéré : dernière position connue, `age` en secondes */
  const GAP=Math.max(2, (rep.interval||2)*1.6);
  function posAt(v,time){
    const tr=v.track; if(!tr||!tr.length) return null;
    if(v.deathT!=null && time>=v.deathT){        // détruit : dernière position avant la mort
      let p=tr[0];
      for(let i=0;i<tr.length;i++){ if(tr[i][0]<=v.deathT) p=tr[i]; else break; }
      return {x:p[1],z:p[2],dead:true,spotted:true,age:0};
    }
    if(time < tr[0][0]) return null;             // pas encore repéré une seule fois
    let lo=null, hi=null;
    for(let i=0;i<tr.length;i++){ if(tr[i][0]<=time) lo=tr[i]; else { hi=tr[i]; break; } }
    if(!lo) return null;
    const yaw=(lo.length>3 ? lo[3] : null);      // direction visée (si le mod l'a captée)
    const cont = hi && (hi[0]-lo[0])<=GAP;       // point suivant assez proche = suivi continu
    if(cont){ const f=(time-lo[0])/((hi[0]-lo[0])||1);
      return {x:lo[1]+(hi[1]-lo[1])*f, z:lo[2]+(hi[2]-lo[2])*f, dead:false, spotted:true, age:0, yaw:yaw}; }
    const age=time-lo[0];
    return {x:lo[1], z:lo[2], dead:false, spotted:(age<=GAP), age:Math.max(0,age-GAP), yaw:yaw};
  }

  // Quadrillage de la minimap du jeu : 10x10, colonnes A..J, lignes 1..10.
  const GRID=10, LET="ABCDEFGHIJ";
  function drawGrid(){
    const cell=W/GRID;
    ctx.save();
    ctx.strokeStyle="rgba(255,255,255,.16)"; ctx.lineWidth=1;
    for(let i=1;i<GRID;i++){
      const p=Math.round(i*cell)+.5;
      ctx.beginPath(); ctx.moveTo(p,0); ctx.lineTo(p,W); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0,p); ctx.lineTo(W,p); ctx.stroke();
    }
    // bordure extérieure
    ctx.strokeStyle="rgba(255,255,255,.26)"; ctx.lineWidth=1.5;
    ctx.strokeRect(.75,.75,W-1.5,W-1.5);
    // repères : lettres en haut, chiffres à gauche
    const fs=Math.round(12*K);
    ctx.font="800 "+fs+"px system-ui,sans-serif";
    ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillStyle="rgba(255,255,255,.55)";
    ctx.shadowColor="rgba(0,0,0,.85)"; ctx.shadowBlur=3*K;
    for(let i=0;i<GRID;i++){
      ctx.fillText(LET[i], i*cell+cell/2, fs*0.9);
      ctx.fillText(String(i+1), fs*0.75, i*cell+cell/2);
    }
    ctx.restore();
  }
  function draw(){
    ctx.clearRect(0,0,W,W);
    drawGrid();
    // --- bases : uniquement le drapeau d'origine du jeu (pas de cercle de zone) ---
    (rep.bases||[]).forEach(b=>{
      const px=wx(b.x), py=wy(b.z);
      const kind=b.team==="ally"?"green":(b.team==="enemy"?"red":"neutral");
      const im=RP_BASE_IMG[kind];
      // le sprite neutre a une source plus petite (32px) : on le grossit pour
      // que les trois drapeaux aient la même taille visible
      if(im){ const S=52*K*(kind==="neutral"?1.35:1); ctx.drawImage(im, px-S/2, py-S/2, S, S); }
      else { const col=b.team==="ally"?ALLY:(b.team==="enemy"?ENEMY:INK);
        ctx.beginPath(); ctx.arc(px,py,9*K,0,7); ctx.fillStyle=col; ctx.globalAlpha=.9; ctx.fill(); ctx.globalAlpha=1; }
    });
    // --- traces récentes (20 dernières secondes) ---
    rep.vehicles.forEach(v=>{
      const tr=v.track; if(!tr||tr.length<2) return;
      const end=(v.deathT!=null)? Math.min(t,v.deathT) : t;
      const pts=tr.filter(p=>p[0]<=end && p[0]>=end-20);
      if(pts.length<2) return;
      // la trace est COUPÉE pendant les périodes sans repérage (pas de trait qui
      // traverse la carte entre deux apparitions)
      ctx.beginPath(); ctx.moveTo(wx(pts[0][1]),wy(pts[0][2]));
      for(let i=1;i<pts.length;i++){
        if(pts[i][0]-pts[i-1][0] > GAP) ctx.moveTo(wx(pts[i][1]),wy(pts[i][2]));
        else ctx.lineTo(wx(pts[i][1]),wy(pts[i][2]));
      }
      ctx.strokeStyle=v.ally?ALLY:ENEMY; ctx.globalAlpha=(hover&&hover!==v)?.10:.28;
      ctx.lineWidth=((hover===v)?2.5:1.5)*K; ctx.stroke(); ctx.globalAlpha=1;
    });
    // --- traits de dégâts (attaquant -> cible), ~1 s ---
    dmgEvents.forEach(d=>{ const age=t-d.t;
      if(age<0||age>=1) return;
      const a=rep.byId[d.attacker], vv=rep.byId[d.victim];
      if(!a||!vv) return;
      const pa=posAt(a,d.t), pv=posAt(vv,d.t); if(!pa||!pv) return;
      ctx.beginPath(); ctx.moveTo(wx(pa.x),wy(pa.z)); ctx.lineTo(wx(pv.x),wy(pv.z));
      ctx.strokeStyle=DMG; ctx.globalAlpha=(1-age)*.55; ctx.lineWidth=1.5*K; ctx.stroke(); ctx.globalAlpha=1;
    });
    // --- tirs : flash court ---
    shots.forEach(s=>{ const age=t-s.t;
      if(age>=0 && age<1.0){ const px=wx(s.x), py=wy(s.z), k=age;
        ctx.beginPath(); ctx.arc(px,py,(3+k*9)*K,0,7); ctx.strokeStyle=SHOT; ctx.globalAlpha=(1-k)*.85; ctx.lineWidth=2*K; ctx.stroke();
        ctx.globalAlpha=1; }
    });
    // --- chars ---
    hover=null;
    rep.vehicles.forEach(v=>{
      const p=posAt(v,t); if(!p) return;
      const px=wx(p.x), py=wy(p.z), col=v.ally?ALLY:ENEMY;
      if(mouse && Math.hypot(mouse.x-px, mouse.y-py)<14*K) hover=v;
      if(p.dead){
        ctx.globalAlpha=.5; ctx.strokeStyle=col; ctx.lineWidth=2.2*K;
        ctx.beginPath(); ctx.moveTo(px-6*K,py-6*K); ctx.lineTo(px+6*K,py+6*K); ctx.moveTo(px+6*K,py-6*K); ctx.lineTo(px-6*K,py+6*K);
        ctx.stroke(); ctx.globalAlpha=1; return;
      }
      // Plus repéré -> l'icône s'estompe (position = dernier point connu) et
      // s'efface progressivement. Repéré -> pleine opacité.
      const fade = p.spotted ? 1 : Math.max(.26, .62 - p.age*0.035);
      ctx.globalAlpha = fade;
      // --- direction visée : cône à peine visible (caisse + tourelle) ---
      if(p.yaw!=null){
        const rad=p.yaw*Math.PI/180;
        const dx=Math.sin(rad), dy=-Math.cos(rad);          // monde +Z = haut de la carte
        const base=Math.atan2(dy,dx), half=13*Math.PI/180, L=34*K;
        ctx.beginPath(); ctx.moveTo(px,py);
        ctx.arc(px,py,L,base-half,base+half); ctx.closePath();
        const gr=ctx.createRadialGradient(px,py,3*K,px,py,L);
        gr.addColorStop(0, col); gr.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalAlpha=fade*0.20; ctx.fillStyle=gr; ctx.fill(); ctx.globalAlpha=fade;
      }
      // --- le glyphe de classe SEUL, aux couleurs de son équipe ---
      const S=Math.round(20*K), SH=Math.round(S+5*K);
      if(v.cls){
        const halo=rpTinted(v.cls,"#080807",SH);            // contour sombre = lisible sur carte claire
        if(halo) ctx.drawImage(halo, px-SH/2, py-SH/2, SH, SH);
        const g=rpTinted(v.cls,col,S);
        if(g) ctx.drawImage(g, px-S/2, py-S/2, S, S);
      } else {
        ctx.beginPath(); ctx.arc(px,py,5.5*K,0,7); ctx.fillStyle=col; ctx.fill();
        ctx.lineWidth=1.5*K; ctx.strokeStyle="rgba(0,0,0,.6)"; ctx.stroke();
      }
      // --- anneau de points de vie : la part perdue devient grise ---
      const hp=hpAt(v,t);
      if(hp!=null){
        const frac=Math.max(0,Math.min(1,hp/v.maxHp)), rr=S*0.80;
        ctx.lineWidth=2.6*K; ctx.lineCap="butt";
        ctx.beginPath(); ctx.arc(px,py,rr,0,Math.PI*2);
        ctx.strokeStyle="rgba(255,255,255,.17)"; ctx.stroke();     // fond = PV perdus
        if(frac>0){
          ctx.beginPath(); ctx.arc(px,py,rr,-Math.PI/2,-Math.PI/2+Math.PI*2*frac);
          ctx.strokeStyle=col; ctx.stroke();                        // restant = couleur d'équipe
        }
      }
      if(!p.spotted){   // liseré pointillé = dernière position connue
        ctx.beginPath(); ctx.arc(px,py,S*0.80+3.5*K,0,7); ctx.strokeStyle=col; ctx.lineWidth=1.2*K;
        ctx.setLineDash([3*K,3*K]); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
    });
    // --- infobulle du char survolé ---
    if(hover){
      const p=posAt(hover,t);
      if(p){ const px=wx(p.x), py=wy(p.z);
        ctx.beginPath(); ctx.arc(px,py,15*K,0,7); ctx.strokeStyle=INK; ctx.globalAlpha=.85; ctx.lineWidth=1.5*K; ctx.stroke(); ctx.globalAlpha=1;
        const d=(rep.dmgBy||{})[hover.id]||0;
        tip.innerHTML="<b>"+esc2(hover.name||"?")+"</b>"
          +(hover.tank?' <span style="color:var(--ink-2)">'+esc2(hover.tank)+"</span>":"")
          +(d?" — "+fmt(d)+" dég.":"")
          +(p.spotted||p.dead?"":' <span style="color:var(--muted)">· hors repérage</span>');
        tip.style.left=(px/W*100)+"%"; tip.style.top=(py/W*100)+"%"; tip.classList.add("on");
      }
    } else tip.classList.remove("on");
  }
  /* Journal en temps réel : on ne révèle que les événements déjà survenus,
     et on suit automatiquement le dernier. */
  let logShown=-1;
  function renderFeed(force){
    if(!logEl) return;
    let n=0; while(n<journal.length && journal[n].t<=t) n++;
    if(!force && n===logShown) return;
    const kids=logEl.children;
    if(logShown<0){ for(let i=0;i<kids.length;i++) kids[i].classList.remove("on","last"); logShown=0; }
    if(n>logShown){ for(let i=logShown;i<n;i++) kids[i].classList.add("on"); }
    else if(n<logShown){ for(let i=n;i<logShown;i++) kids[i].classList.remove("on"); }
    if(logShown>0 && kids[logShown-1]) kids[logShown-1].classList.remove("last");
    if(n>0 && kids[n-1]){ kids[n-1].classList.add("last");
      const el=kids[n-1];
      logEl.scrollTop=Math.max(0, el.offsetTop-logEl.clientHeight+el.offsetHeight+6);
    }
    logShown=n;
    if(jnEl) jnEl.textContent=n+" / "+journal.length;
  }
  function frame(now){
    if(!document.body.contains(cv)) return;
    const dt=(now-last)/1000; last=now;
    if(playing){ t+=dt*speed; if(t>=rep.duration){ t=rep.duration; playing=false; playBtn.textContent="▶"; } scrub.value=t; }
    timeEl.textContent=fmtT(t)+" / "+durFR(rep.duration);
    draw(); if(playing) renderFeed();
    requestAnimationFrame(frame);
  }
  function seek(nt){ t=Math.max(0,Math.min(rep.duration,nt)); scrub.value=t;
    timeEl.textContent=fmtT(t)+" / "+durFR(rep.duration); draw(); renderFeed(); }

  playBtn.onclick=()=>{ if(t>=rep.duration) t=0; playing=!playing; playBtn.textContent=playing?"❚❚":"▶"; last=performance.now(); draw(); };
  scrub.oninput=()=>{ playing=false; playBtn.textContent="▶"; seek(+scrub.value); };
  speedSel.onchange=()=>{ speed=+speedSel.value; };
  host.querySelectorAll(".rp-step").forEach(b=>b.onclick=()=>{ playing=false; playBtn.textContent="▶"; seek(t+(+b.dataset.step)); });
  cv.addEventListener("mousemove",e=>{ const r=cv.getBoundingClientRect();
    mouse={x:(e.clientX-r.left)/r.width*W, y:(e.clientY-r.top)/r.height*W}; draw(); });
  cv.addEventListener("mouseleave",()=>{ mouse=null; hover=null; tip.classList.remove("on"); draw(); });

  rpLoadIcons(()=>{ if(document.body.contains(cv)) draw(); });   // icônes de classe (async)
  timeEl.textContent="0:00 / "+durFR(rep.duration); renderFeed(); draw();
  requestAnimationFrame(frame);
}

async function searchClans(){
  const query=document.getElementById("clanQuery").value.trim();
  const res=document.getElementById("clanResults");
  document.getElementById("searchedClan").innerHTML="";
  if(query.length<2){ res.innerHTML='<div class="empty">Tape au moins 2 caractères.</div>'; return; }
  res.innerHTML=cpLoader('Recherche…');
  const r=await fnCall("clan-lookup",{session:localStorage.getItem(LS_SESSION),query});
  if(!r.ok){ res.innerHTML='<div class="empty">Erreur : '+esc(r.j.error||String(r.status))+'</div>'; return; }
  const list=r.j.results||[];
  if(!list.length){ res.innerHTML='<div class="empty">Aucun clan trouvé.</div>'; return; }
  res.innerHTML=list.map(c=>{
    const em=(c.emblems&&c.emblems.x32&&c.emblems.x32.portal)||"";
    const emHtml=em?`<img class="res-em" src="${esc(em)}" alt="" loading="lazy">`:`<span class="res-em res-em-ph">${esc((c.tag||"?").slice(0,2))}</span>`;
    return `<div class="res-row" data-id="${c.clan_id}">${emHtml}
    <span class="rt">[${esc(c.tag||"")}]</span><span class="rn">${esc(c.name||"")}</span>
    <span class="rm">${fmt(c.members_count||0)} membres</span></div>`;}).join("");
  res.querySelectorAll(".res-row").forEach(row=>row.onclick=()=>openSearchedClan(Number(row.dataset.id)));
}
async function openSearchedClan(clanId){
  const sc=document.getElementById("searchedClan");
  sc.innerHTML='<div class="card">'+cpLoader()+'</div>';
  const r=await fnCall("clan-lookup",{session:localStorage.getItem(LS_SESSION),clan_id:clanId});
  if(!r.ok || (!r.j.info && !r.j.ratings)){ sc.innerHTML='<div class="card"><div class="empty">Impossible de charger ce clan.</div></div>'; return; }
  let h=clanBlockHTML(r.j.info, r.j.ratings);
  const members=r.j.members||[];
  if(members.length){
    const sorted=members.slice().sort((a,b)=>{
      const ra=ROLE_ORDER[normRole(a.role_i18n)]!=null?ROLE_ORDER[normRole(a.role_i18n)]:9;
      const rb=ROLE_ORDER[normRole(b.role_i18n)]!=null?ROLE_ORDER[normRole(b.role_i18n)]:9;
      if(ra!==rb) return ra-rb; return String(a.account_name||"").localeCompare(String(b.account_name||""));
    });
    h+=`<div class="card" style="margin-top:14px"><h2>Membres <span class="hint">(${members.length})</span></h2><div class="members">`+
      sorted.map(m=>`<div class="mem"><span class="mn">${esc(m.account_name||"?")}</span><span class="mr">${esc(ROLE_FR[normRole(m.role_i18n)]||m.role_i18n||"")}</span></div>`).join("")+
      `</div></div>`;
  }
  sc.innerHTML=h;
}

let MEM_EXPANDED=false;
let MEM_SORT={k:"sr",dir:-1};   // tri du tableau des membres
function memCmp(a,b){
  const k=MEM_SORT.k, d=MEM_SORT.dir;
  if(k==="name") return d*String(a.name).localeCompare(String(b.name));
  if(k==="ord")  return (a.ord-b.ord)*d || String(a.name).localeCompare(String(b.name));
  const av=a[k]||0, bv=b[k]||0;                 // sr / bat / ts : numériques
  if((av===0)!==(bv===0)) return av===0?1:-1;   // les "—" (sans données) toujours en bas
  return d*(av-bv) || String(a.name).localeCompare(String(b.name));
}
// vraies icônes de grade du jeu (extraites de gui-part*.pkg -> web/roles/) ; clés API -> ancien nom de fichier WoT
const ROLE_ICON={commander:"leader",executive_officer:"vice_leader",deputy_commander:"vice_leader",
  combat_officer:"commander",personnel_officer:"staff",intelligence_officer:"diplomat",quartermaster:"treasurer",
  recruitment_officer:"recruiter",junior_officer:"junior",private:"private",recruit:"recruit",reservist:"reservist"};
function roleIcon(role){ const k=ROLE_ICON[normRole(role)]; return k?("roles/"+k+".png"):""; }
function renderMembers(){
  const el=document.getElementById("members"); if(!el) return;
  const stat={};
  RAW.forEach(r=>{ if(!r.isMember||r.accId==null) return;
    const s=stat[r.accId]=stat[r.accId]||{s:0,n:0,ts:0,bset:new Set()};
    const _v=srBattle(r); if(_v!=null){ s.s+=_v; s.n++; } s.bset.add(r.battleId); if(r.ts>s.ts)s.ts=r.ts; });
  const list=(MEMBERS||[]).map(m=>{
    const st=stat[Number(m.account_id)];
    const ord=ROLE_ORDER[normRole(m.wg_role)]!=null?ROLE_ORDER[normRole(m.wg_role)]:9;
    return { name:m.nickname||"?", role:ROLE_FR[normRole(m.wg_role)]||m.wg_role||"", ord,
      icon: roleIcon(m.wg_role),
      sr: st?Math.round(st.s/st.n):null, bat: st?st.bset.size:0, ts: st?st.ts:0,
      me:(ME_ID!=null && Number(m.account_id)===Number(ME_ID)) };
  }).sort(memCmp);
  const mc=document.getElementById("memCount"); if(mc) mc.textContent=list.length||"";
  if(!list.length){ el.innerHTML='<div style="color:var(--muted);padding:16px">Roster pas encore importé — il se remplit à la connexion d\'un membre.</div>'; return; }
  const gCls=o=>o<=1?"g-cmd":o<=3?"g-off":"g-sol";
  const shown=MEM_EXPANDED?list:list.slice(0,12);
  const mcols=[["name","Joueur"],["ord","Grade"],["sr","SR"],["bat","Batailles"],["ts","Vu le"]];
  const mArw=k=>k===MEM_SORT.k?(MEM_SORT.dir<0?" ▼":" ▲"):"";
  const mTh=mcols.map(c=>`<th data-k="${c[0]}" class="${c[0]===MEM_SORT.k?'sorted':''}">${c[1]}${mArw(c[0])}</th>`).join("");
  el.innerHTML=`<table class="memtbl"><thead><tr>${mTh}</tr></thead><tbody>`
    +shown.map(m=>{
      const av=m.icon
        ? `<span class="av rav" title="${esc(m.role)}"><img src="${m.icon}" alt="${esc(m.role)}" onerror="this.parentNode.textContent='${esc(String(m.name)[0].toUpperCase())}';this.parentNode.classList.remove('rav')"></span>`
        : `<span class="av">${esc(String(m.name)[0].toUpperCase())}</span>`;
      const sr=m.sr!=null?`<span class="pr" style="color:${srColor(m.sr)}">${fmt(m.sr)}</span>`:'<span style="color:var(--muted)">—</span>';
      const vu=m.ts?new Date(m.ts*1000).toLocaleDateString(window.CP_LOC,{day:"2-digit",month:"2-digit"}):'<span style="color:var(--muted)">—</span>';
      return `<tr${m.me?' style="background:rgba(229,185,92,.06)"':''}><td><span class="pn">${av}${esc(m.name)}</span></td><td><span class="grade ${gCls(m.ord)}">${esc(m.role)}</span></td><td>${sr}</td><td>${m.bat||'<span style="color:var(--muted)">—</span>'}</td><td style="color:var(--ink-2)">${vu}</td></tr>`;
    }).join("")+`</tbody></table>`;
  el.querySelectorAll("thead th[data-k]").forEach(th=>th.onclick=()=>{
    const k=th.dataset.k;
    if(MEM_SORT.k===k) MEM_SORT.dir*=-1; else { MEM_SORT.k=k; MEM_SORT.dir=(k==="name"||k==="ord")?1:-1; }
    renderMembers();
  });
  const more=document.getElementById("memMore");
  if(more){ if(list.length>12){ more.classList.remove("hidden"); more.textContent=MEM_EXPANDED?"Réduire ▴":("Afficher les "+list.length+" membres ↓"); more.onclick=()=>{MEM_EXPANDED=!MEM_EXPANDED; renderMembers();}; } else more.classList.add("hidden"); }
}

let VEHMAP={}, MEMBERSET=new Set(), CLANTAG="", BATTLE_ENEMY={}, BATTLE_TIER={};
function buildRaw(data){
  CLANTAG = (data.clan && data.clan.tag) ? String(data.clan.tag) : "";
  VEHMAP = {}; (data.vehicles||[]).forEach(v=>{ VEHMAP[Number(v.tank_id)]=v; });
  MEMBERSET = new Set((data.members||[]).map(m=>Number(m.account_id)));
  const bmap = {};
  (data.battles||[]).forEach(b=>{
    bmap[b.battle_id] = { ts: b.ts?Math.floor(new Date(b.ts).getTime()/1000):0, mode:b.mode||"",
      result: b.result, mapName: b.map_name || ("Carte "+(b.map_id||"?")) };
  });
  /* ── Doublons de bataille ────────────────────────────────────────
     Quand DEUX membres du clan ont le mod, les deux envoient la même
     bataille. `ingest` fait DELETE puis INSERT en deux requêtes : si les
     deux envois se chevauchent, les deux DELETE passent avant les deux
     INSERT et la bataille finit avec 14 lignes au lieu de 7. D'où
     l'intermittence — il faut que les envois tombent dans la même
     fraction de seconde.

     La cause est corrigée côté serveur, mais les batailles déjà en base
     restent doublées. On filtre donc ici : une ligne par (bataille,
     joueur, char). Sans ça, les totaux d'équipe sont doublés — 32 620
     de dégâts affichés pour 16 310 réellement infligés. */
  const vus = new Set();
  let doublons = 0;
  const brut = (data.players||[]).filter(pl=>{
    const cle = pl.battle_id + "|" + (pl.account_id ?? pl.name ?? "?") + "|" + pl.veh;
    if(vus.has(cle)){ doublons++; return false; }
    vus.add(cle); return true;
  });
  if(doublons) console.warn("[données] "+doublons+" ligne(s) de joueur en double, ignorée(s)");

  RAW = brut.map(pl=>{
    const b = bmap[pl.battle_id] || {ts:0,mode:"",result:null,mapName:""};
    const vm = VEHMAP[Number(pl.veh)] || null;
    return {
      battleId: String(pl.battle_id), ts:b.ts, mode:b.mode, result: b.result, mapName:b.mapName,
      accId: pl.account_id!=null?Number(pl.account_id):null,
      name: pl.name||"?", clan: pl.player_clan||"", team: pl.team,
      veh:Number(pl.veh)||0, cls: vm?vm.cls:"", tank: vm?vm.name:"",
      dmg:+pl.dmg||0, block:+pl.block||0, assist:+pl.assist||0, spot:+pl.spot||0,
      kills:+pl.kills||0, surv: pl.surv===true||pl.surv==="true", xp:+pl.xp||0,
      life:+pl.life||0, shots:+pl.shots||0, hits:+pl.hits||0, pierce:+pl.pierce||0,
      dmgr:+pl.dmgr||0, cap:+pl.cap||0, decap:+pl.decap||0,
      aradio:+pl.a_radio||0, atrack:+pl.a_track||0, astun:+pl.a_stun||0,
      pot:+pl.pot_recv||0, hitsr:+pl.hits_recv||0, piercer:+pl.pierce_recv||0, bounce:+pl.bounce||0,
      maxhp:+pl.max_hp||0, hpleft:+pl.hp_left||0, dist:+pl.dist||0, sniper:+pl.dmg_sniper||0, dmginvis:+pl.dmg_invis||0,
      isMember: pl.account_id!=null && MEMBERSET.has(Number(pl.account_id)),
    };
  });
  // référence GLOBALE de la Cote d'Équipe : tous les joueurs enregistrés (nous + tous les adversaires)
  CE_REF=teamGlobalRef(RAW);
  // clan adverse par bataille : le tag (hors le nôtre) le plus fréquent
  BATTLE_ENEMY={}; const cnt={};
  RAW.forEach(r=>{
    if(r.clan && r.clan.toUpperCase()!==CLANTAG.toUpperCase()){
      (cnt[r.battleId]=cnt[r.battleId]||{}); cnt[r.battleId][r.clan]=(cnt[r.battleId][r.clan]||0)+1;
    }
  });
  Object.keys(cnt).forEach(bid=>{ let best="",bn=0;
    for(const t in cnt[bid]){ if(cnt[bid][t]>bn){bn=cnt[bid][t];best=t;} } BATTLE_ENEMY[bid]=best; });
  // Rang de Bastion par bataille, décidé UNE fois pour toutes.
  // ⚠️ Même règle que srBuild : le tier MÉDIAN des chars présents, pas celui d'une
  // ligne isolée. Un char absent de la table des véhicules ferait autrement
  // disparaître la bataille de l'affichage alors que le SR, lui, la compte.
  BATTLE_TIER={}; const tpar={};
  RAW.forEach(r=>{ const t=Number((VEHMAP[r.veh]||{}).tier)||0;
    if(t) (tpar[r.battleId]=tpar[r.battleId]||[]).push(t); });
  Object.keys(tpar).forEach(bid=>{ const v=tpar[bid].sort((a,b)=>a-b);
    const med=v[Math.floor(v.length/2)];
    BATTLE_TIER[bid]= med>=10?10:(med>=8?8:6); });
  // bannière si vide
  /* #banner n'existe que sur index.html. buildRaw est une fonction de
     DONNÉES : elle ne devrait pas toucher au DOM du tout. En attendant
     de l'en séparer, l'accès est rendu tolérant — sans quoi la page
     dédiée à la progression s'arrête ici, avant tout affichage. */
  const b = document.getElementById("banner");
  if(!b){ /* page sans bannière : rien à dire */ }
  else if(!RAW.length){ b.classList.remove("hidden");
    b.textContent = "Aucune bataille pour l'instant. Dès que toi ou un membre jouez une bataille Bastion avec le mod, elle apparaîtra ici."; }
  else b.classList.add("hidden");
}

/* ============================================================
   ÉCRANS DE CONNEXION (helpers)
   ============================================================ */
function showLogin(){
  document.getElementById("landing").classList.add("hidden");
  document.getElementById("app").classList.add("hidden");
  document.getElementById("loginScreen").classList.remove("hidden");
  const btn=document.getElementById("wgLogin");
  btn.disabled=false; btn.textContent="▶ Se connecter avec World of Tanks";
  btn.onclick=()=>{ location.href = wgLoginUrl(); };
  const back=document.getElementById("loginBack");
  if(back) back.onclick=(e)=>{ e.preventDefault(); showLanding(); };
}
function showLoginBusy(txt){
  document.getElementById("landing").classList.add("hidden");
  document.getElementById("app").classList.add("hidden");
  document.getElementById("loginScreen").classList.remove("hidden");
  const btn=document.getElementById("wgLogin"); btn.disabled=true; btn.textContent=txt;
  document.getElementById("loginErr").classList.add("hidden");
}
function showLoginError(msg){
  showLogin();
  const e=document.getElementById("loginErr"); e.textContent=msg; e.classList.remove("hidden");
}

/* ============================================================
   CONNEXION WARGAMING — reprises et messages parlants

   L'API publique de Wargaming plafonne à 10 requêtes/seconde par
   application_id, TOUS utilisateurs confondus, et sert régulièrement des
   504. Une connexion déclenche jusqu'à cinq appels côté serveur. Sans
   reprise, un simple pic refusait une connexion parfaitement valide —
   c'est le « parfois ça ne marche pas ».

   On distingue donc trois familles :
     · 401 invalid_token  → définitif, il faut se reconnecter à Wargaming ;
     · 503 wg_indisponible → passager, on réessaie tout seul ;
     · le reste           → on affiche un message clair + un bouton.
   ============================================================ */
const WG_ERREURS = {
  invalid_token:   "Ta session Wargaming a expiré. Reconnecte-toi.",
  wg_indisponible: "L'API Wargaming est saturée en ce moment. Réessaie dans quelques secondes.",
  wg_verify_error: "Wargaming n'a pas pu vérifier ton compte. Réessaie dans un instant.",
  wg_clan_error:   "Wargaming n'a pas pu renvoyer ton clan. Réessaie dans un instant.",
  missing_params:  "Paramètres de connexion incomplets. Reconnecte-toi depuis l'accueil.",
};
/* Un message d'erreur qui propose une SORTIE, pas seulement un constat.
   `action` est ce que fait le bouton ; sans action, pas de bouton. */
function loginErrAvecReprise(msg, action, libelle){
  showLogin();
  const e = document.getElementById("loginErr");
  e.textContent = "";
  e.append(msg + " ");
  if(action){
    const b = document.createElement("button");
    b.type = "button"; b.textContent = libelle || "Réessayer";
    b.style.cssText = "margin-left:6px;font:inherit;font-weight:600;color:var(--accent);"
      + "background:none;border:0;text-decoration:underline;cursor:pointer;padding:0";
    b.onclick = action;
    e.appendChild(b);
  }
  e.classList.remove("hidden");
}
async function connecteWg(ids){
  let res = null;
  for(let n = 1; n <= 3; n++){
    showLoginBusy(n === 1 ? "Connexion en cours…"
                          : "Wargaming est occupé — nouvelle tentative (" + n + "/3)…");
    res = await fnCall("wg-login", ids);
    // succès, ou refus DÉFINITIF : inutile d'insister
    if(res.ok || res.status === 400 || res.status === 401) break;
    if(n < 3) await new Promise(r => setTimeout(r, n * 1200));
  }
  if(res && res.ok && res.j.session){
    localStorage.setItem(LS_SESSION, res.j.session);
    if(res.j.nickname) localStorage.setItem("cp_nick", res.j.nickname);
    if(res.j.clan){ localStorage.setItem("cp_clan", String(res.j.clan.clan_id)); await openApp(); }
    else { localStorage.setItem("cp_clan", ""); location.href = "trouver-clan.html"; }
    return;
  }
  const code = (res && res.j && res.j.error) || (res ? "http_" + res.status : "reseau");
  const msg  = WG_ERREURS[code] || ("La connexion a échoué (" + code + ").");
  // un jeton expiré ne se rejoue pas : il faut repasser par Wargaming
  if(code === "invalid_token"){
    loginErrAvecReprise(msg, () => { location.href = wgLoginUrl(); }, "Se reconnecter");
  }else{
    loginErrAvecReprise(msg, () => connecteWg(ids));
  }
  console.warn("[connexion] échec :", code, res && res.j && res.j.detail);
}

/* ============================================================
   PAGE D'ACCUEIL PUBLIQUE + PAGES LÉGALES
   ============================================================ */
function showLanding(){
  document.getElementById("app").classList.add("hidden");
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("landing").classList.remove("hidden");
  window.scrollTo(0,0);
  if(localStorage.getItem("cp_cookie_ok")!=="1")
    document.getElementById("cookieBar").classList.remove("hidden");
}
let _landingWired=false;
function wireLanding(){
  if(_landingWired) return; _landingWired=true;
  ["lpLogin","lpLoginTop"].forEach(id=>{
    const el=document.getElementById(id); if(el) el.onclick=()=>showLogin();
  });
  // liens légaux (accueil, footer, bandeau cookies)
  document.querySelectorAll("[data-legal]").forEach(a=>{
    a.addEventListener("click",e=>{ e.preventDefault(); openLegal(a.getAttribute("data-legal")); });
  });
  // bandeau cookies
  const ok=document.getElementById("cookieOk");
  if(ok) ok.onclick=()=>{ localStorage.setItem("cp_cookie_ok","1"); document.getElementById("cookieBar").classList.add("hidden"); };
  // modale : fermeture
  const mod=document.getElementById("legalModal"), x=document.getElementById("legalClose");
  if(x) x.onclick=()=>mod.classList.add("hidden");
  if(mod) mod.addEventListener("click",e=>{ if(e.target===mod) mod.classList.add("hidden"); });
  document.addEventListener("keydown",e=>{ if(e.key==="Escape") mod.classList.add("hidden"); });
}
const LEGAL_UPD="Dernière mise à jour : juillet 2026";
const LEGAL={
  legal:`<div class="lp-legal"><h2>Mentions légales</h2><p class="lp-legal-upd">${LEGAL_UPD}</p>
    <h3>Éditeur du site</h3><p>Clan&nbsp;Plus est un projet communautaire indépendant, à but non lucratif, créé et maintenu par le clan <b>[ATFR]</b> sur World of Tanks.<br>Contact : pour toute demande, adresse-toi à un responsable du clan [ATFR] en jeu.</p>
    <h3>Hébergement</h3><p>Le site est hébergé par <b>Netlify, Inc.</b> (2325 3rd Street, San Francisco, CA 94107, États-Unis — <a href="https://www.netlify.com" target="_blank" rel="noopener">netlify.com</a>).<br>Les données applicatives (comptes, statistiques) sont hébergées par <b>Supabase</b> sur des serveurs situés dans l'Union européenne — <b>Stockholm, Suède</b> (<a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a>).</p>
    <h3>Propriété intellectuelle</h3><p><i>World of Tanks</i>, <i>Wargaming</i> et les éléments graphiques associés sont la propriété de Wargaming. Clan&nbsp;Plus n'est <b>pas affilié à, ni approuvé par Wargaming</b>. Le mod et le site sont fournis gratuitement, sans garantie, à usage communautaire.</p></div>`,
  privacy:`<div class="lp-legal"><h2>Politique de confidentialité</h2><p class="lp-legal-upd">${LEGAL_UPD}</p>
    <p>Cette page explique quelles données Clan&nbsp;Plus traite et pourquoi. Nous appliquons le principe de minimisation : nous ne collectons que le strict nécessaire au fonctionnement du service.</p>
    <h3>Responsable du traitement</h3><p>Le responsable est l'éditeur du site (voir Mentions légales). Pour toute demande, adresse-toi à un responsable du clan [ATFR].</p>
    <h3>Données collectées</h3><ul>
      <li><b>À la connexion</b> (via le service officiel Wargaming / OpenID) : ton identifiant de compte, ton pseudo et ton appartenance à un clan. <b>Nous ne voyons jamais ton mot de passe.</b></li>
      <li><b>Via le mod</b> (que tu installes volontairement) : les statistiques de tes batailles de Bastion — dégâts, assistance, repérage, blocage, survie, char joué, carte, résultat, et positions pour le relecteur.</li>
    </ul>
    <h3>Finalités</h3><p>Ces données servent uniquement à afficher les statistiques de ton clan, à calculer les indicateurs (dont le SR) et à proposer un suivi de progression. <b>Aucune publicité, aucune revente de données.</b></p>
    <h3>Destinataires &amp; hébergement</h3><p>Les statistiques de clan sont visibles par les membres de ton clan. Aucune donnée n'est transmise à des tiers publicitaires. Prestataires techniques : Wargaming (authentification), Supabase (base de données, hébergée dans l'Union européenne — Stockholm, Suède), Netlify (hébergement du site).</p>
    <h3>Conservation</h3><p>Tes données sont conservées tant que tu utilises le service. Tu peux demander leur suppression à tout moment.</p>
    <h3>Tes droits (RGPD)</h3><p>Tu disposes d'un droit d'accès, de rectification, d'effacement et d'opposition. Pour les exercer, adresse-toi à un responsable du clan [ATFR]. Tu peux aussi te déconnecter et cesser d'utiliser le mod à tout moment.</p>
    <h3>Cookies et stockage local</h3><p>Voir la page <a href="#" data-legal="cookies">Cookies</a> : le site n'utilise que du stockage technique essentiel, sans traceur.</p></div>`,
  cookies:`<div class="lp-legal"><h2>Cookies &amp; stockage local</h2><p class="lp-legal-upd">${LEGAL_UPD}</p>
    <p>Clan&nbsp;Plus <b>n'utilise aucun cookie publicitaire ni traceur</b>. Le site enregistre uniquement quelques informations techniques dans le stockage local de ton navigateur (<code>localStorage</code>), strictement nécessaires à son fonctionnement :</p>
    <ul>
      <li><code>cp_session</code> — te garder connecté à ta session.</li>
      <li><code>clanplus_theme</code> — mémoriser le thème clair ou sombre.</li>
      <li><code>cp_sidebar</code> — mémoriser si le menu est replié.</li>
      <li><code>cp_cookie_ok</code> — mémoriser que tu as vu le bandeau d'information.</li>
    </ul>
    <p>Ces éléments étant strictement nécessaires, ils ne requièrent pas de consentement préalable selon la réglementation (RGPD / directive ePrivacy). Tu peux les effacer à tout moment en vidant les données du site dans ton navigateur.</p></div>`
};
function openLegal(kind){
  const box=document.getElementById("legalBody");
  box.innerHTML=LEGAL[kind]||LEGAL.legal;
  // les liens data-legal à l'intérieur de la modale doivent aussi fonctionner
  box.querySelectorAll("[data-legal]").forEach(a=>a.addEventListener("click",e=>{ e.preventDefault(); openLegal(a.getAttribute("data-legal")); }));
  document.getElementById("legalModal").classList.remove("hidden");
}

/* ============================================================
   FILTRES + AGRÉGATION + RENDU
   ============================================================ */
function applyFilters(){
  const now=Date.now()/1000;
  return RAW.filter(r=>{
    if(state.mode && r.mode!==state.mode) return false;
    if(state.days && r.ts && (now-r.ts)>state.days*86400) return false;
    if(state.search && r.name.toLowerCase().indexOf(state.search.toLowerCase())<0) return false;
    return true;
  });
}
/* ============================================================
   COTE D'ÉQUIPE (CÉ) — structure WN8/WNX adaptée au jeu d'équipe.
   Valeurs "attendues" = moyennes du clan. Calcul PAR BATAILLE ;
   le score global d'un joueur = MOYENNE de ses CÉ par bataille.
   ============================================================ */
let CE_REF=null;                                   // référence GLOBALE (calculée une fois dans buildRaw)
const CE_W={imp:300,frag:100,spot:150,tank:200,win:450,surv:300};   // poids (somme=1500 = niveau global moyen)
// Référence "globale" : moyenne de TOUS les joueurs enregistrés (notre clan + tous les adversaires
// rencontrés). 1500 = ce niveau global ; le clan peut être au-dessus ou en dessous.
// (winrate fixé à 0,5 = vérité globale ; défauts tier 10 tant qu'on a peu de données.)
function teamGlobalRef(rows){
  let n=0,imp=0,frag=0,spot=0,tank=0,surv=0;
  for(const r of rows){ n++; imp+=r.dmg+r.assist; frag+=r.kills; spot+=r.spot; tank+=r.block; surv+=(r.surv?1:0); }
  if(n<20) return {imp:2600,frag:1,spot:1,tank:900,win:0.5,surv:0.4};
  return {imp:(imp/n)||2600,frag:(frag/n)||1,spot:(spot/n)||1,tank:(tank/n)||900,win:0.5,surv:(surv/n)||0.4};
}
function ceForRow(r,C){
  C=C||CE_REF; if(!C) return 1500;
  const rel=(v,c)=>c>0?v/c:1;                       // ratio vs attendu
  const step=(x,f)=>Math.max(0,(x-f)/(1-f));        // palier WN8 (retire le plancher, renormalise)
  const rImp =step(rel(r.dmg+r.assist,C.imp),0.22); // "impact" = dégâts + assistés (colonne vertébrale)
  const rFrag=Math.max(0,Math.min(rImp+0.2,step(rel(r.kills,C.frag),0.12)));
  const rSpot=Math.max(0,Math.min(rImp+0.1,step(rel(r.spot,C.spot),0.38)));
  const rTank=Math.max(0,Math.min(rImp+0.1,step(rel(r.block,C.tank),0.10)));
  const rWin =step(rel(r.result===1?1:0,C.win),0.71);
  const rSurv=step(rel(r.surv?1:0,C.surv),0.30);
  return CE_W.imp*rImp + CE_W.frag*rImp*rFrag + CE_W.spot*rImp*rSpot + CE_W.tank*rImp*rTank
       + CE_W.win*Math.min(1.8,rWin) + CE_W.surv*Math.min(1.8,rSurv);
}
/* ============================================================
   SR SAISON 1 — application du modèle FIGÉ
   Le site n'invente rien : il applique les coefficients calculés une fois par
   `sr-calibrate` et stockés en base. C'est ce qui garantit que l'historique ne
   bouge plus (le défaut majeur de l'ancien SR, dont la référence se recalculait
   à chaque chargement).
     SR = 1500 + échelle × ( 0,40·z(contribution) + 0,25·z(surprise) + 0,35·z(niveau) )
   ============================================================ */
// Marqueur de version : `srVersion()` dans la console dit si le fichier servi
// est bien le dernier. Évite de confondre « pas déployé » et « ne marche pas ».
const SR_SITE_VERSION="sr-4.4-vides";
function srVersion(){ return SR_SITE_VERSION; }
let SR_MODEL=null, SR_SKILL=null, SR_ELO_TAG=null, SR_ELO_ID=null, SR_ROWS=null;
const SR_CLS={heavyTank:"heavy",mediumTank:"medium",lightTank:"light","AT-SPG":"td",SPG:"spg"};

function srInit(data){
  SR_MODEL={};
  (data.srModel||[]).forEach(m=>{ if(m.kind==="weights") SR_MODEL[m.format_key]=m.payload; });
  SR_SKILL=new Map(); (data.srProfiles||[]).forEach(p=>SR_SKILL.set(Number(p.account_id), +p.avg_dmg||0));
  SR_ELO_TAG=new Map(); SR_ELO_ID=new Map();
  (data.clanElo||[]).forEach(c=>{
    const o={10:c.fb10!=null?+c.fb10:null, 8:c.fb8!=null?+c.fb8:null, 6:c.fb6!=null?+c.fb6:null};
    SR_ELO_ID.set(Number(c.clan_id),o);
    if(c.tag) SR_ELO_TAG.set(String(c.tag).toUpperCase(),o);
  });
  SR_ROWS=null; SR_IDX=null; SR_MED={};   // recalculés à la demande
}
const srOk=()=>!!(SR_MODEL&&SR_MODEL["7v7"]);

function srProba(M,gap,eGap){
  const use=M.mesure_ecart, W=(use==="fusion"&&eGap!=null)?M.winprob_fusion
           :(use==="elo_bastion"&&eGap!=null)?M.winprob_elo:M.winprob_rosters;
  if(!W) return 0.5;
  const x=(use==="fusion"&&eGap!=null)?[gap,eGap]:((use==="elo_bastion"&&eGap!=null)?[eGap]:[gap]);
  let z=W.b; for(let j=0;j<W.w.length;j++) z+=W.w[j]*((x[j]-W.mu[j])/W.sd[j]);
  return 1/(1+Math.exp(-z));
}
/* Contribution = PARTS INTRA-ÉQUIPE. Neutre à l'intensité de la bataille :
   une partie longue et violente gonfle tout le monde, les parts ne bougent pas. */
function srContrib(side,M){
  const S=(f)=>side.reduce((a,r)=>a+f(r),0);
  const Td=S(r=>(+r.dmg||0)+(+r.assist||0)), Te=S(r=>(+r.block||0)+(+r.dmgr||0)),
        Tv=S(r=>(+r.spot||0)*300+(+r.a_radio||0)), To=S(r=>(+r.cap||0)+(+r.decap||0));
  const s0=1/side.length, eb=M.e_blindage||0.18, CAP=M.cap||2.5;
  const cap=x=>Math.max(0,Math.min(CAP,x));
  return side.map(r=>{
    const role=SR_CLS[r.cls]||"medium", w=(M.poids&&M.poids[role])||M.poids.medium;
    const enc=(+r.block||0)+(+r.dmgr||0);
    const d={ deg:cap((Td>0?((+r.dmg||0)+(+r.assist||0))/Td:0)/s0),
              enc:cap((Te>0?enc/Te:0)/s0),
              bli:cap(enc>0?((+r.block||0)/enc)/eb:0),
              vis:cap((Tv>0?((+r.spot||0)*300+(+r.a_radio||0))/Tv:0)/s0),
              obj:cap((To>0?((+r.cap||0)+(+r.decap||0))/To:0)/s0) };
    let c=0; for(const k in w) c+=w[k]*(d[k]-1);
    return { row:r, role, c:c-((M.centrage&&M.centrage[role])||0), parts:d };
  });
}
/* Une ligne de SR par (joueur, bataille). C'est la granularité qui permet
   ensuite toutes les analyses : par période, par carte, par classe de char. */
function srBuild(){
  if(!srOk()) return [];
  const byB={}; (RAW||[]).forEach(r=>{ (byB[r.battleId]=byB[r.battleId]||[]).push(r); });
  const TAG=String(CLANTAG||"").toUpperCase(), out=[];
  Object.keys(byB).forEach(bid=>{
    const rows=byB[bid]; if(rows.length<4) return;
    const res=rows[0].result; if(res!==1&&res!==0) return;
    // notre camp = équipe où notre tag est majoritaire
    const cnt={}; rows.forEach(r=>{ if(String(r.clan||"").toUpperCase()===TAG) cnt[r.team]=(cnt[r.team]||0)+1; });
    let mine=null,best=0; for(const t in cnt) if(cnt[t]>best){best=cnt[t];mine=+t;}
    if(mine==null) return;
    const ours=rows.filter(r=>+r.team===mine), theirs=rows.filter(r=>+r.team!==mine);
    if(!ours.length||!theirs.length) return;
    const fmt=Math.max(ours.length,theirs.length)<=8?"7v7":"15v15";
    const M=SR_MODEL[fmt]; if(!M) return;
    const need=fmt==="7v7"?4:8;
    const sk=a=>{ const v=a.map(r=>SR_SKILL.get(Number(r.accId))).filter(x=>x!=null);
                  return v.length>=need? v.reduce((x,y)=>x+y,0)/v.length : null; };
    const s1=sk(ours), s2=sk(theirs); if(s1==null||s2==null) return;
    const gap=s1-s2, lvl=(s1+s2)/2;
    // cote Bastion du bon rang, via le tag majoritaire d'en face
    const ct={}; theirs.forEach(r=>{ const t=String(r.clan||"").toUpperCase(); if(t) ct[t]=(ct[t]||0)+1; });
    let atag="",an=0; for(const t in ct) if(ct[t]>an){an=ct[t];atag=t;}
    const tiers=ours.map(r=>(VEHMAP[r.veh]||{}).tier||0).filter(Boolean).sort((a,b)=>b-a);
    const tb=tiers[Math.floor(tiers.length/2)]||10, rang=tb>=10?10:(tb>=8?8:6);
    // ⭐ Un Bastion Tier VI et un Tier X n'ont ni les mêmes dégâts, ni les mêmes PV,
    // ni la même cote Elo : les mélanger dans une seule note n'a pas de sens. Le
    // jeu impose le tier, donc le tier du char EST celui de la bataille — le test
    // est exact, pas approché. Restreint au X tant qu'un seul rang est calibré.
    if(rang!==SR_TIER) return;
    const eU=(SR_ELO_TAG.get(TAG)||{})[rang]??null, eT=(SR_ELO_TAG.get(atag)||{})[rang]??null;
    const eGap=(eU!=null&&eT!=null)?eU-eT:null, eLvl=(eU!=null&&eT!=null)?(eU+eT)/2:null;
    const surprise=(res===1?1:0)-srProba(M,gap,eGap);
    const NV=M.niveau||{roster:{mu:0,sd:1},elo:{mu:0,sd:1}};
    const zr=(lvl-NV.roster.mu)/(NV.roster.sd||1);
    const niv=eLvl==null?zr:(zr+(eLvl-NV.elo.mu)/(NV.elo.sd||1))/2;
    const Z=M.z, P=M.parts;
    srContrib(ours,M).forEach(c=>{
      const pC=M.echelle*P.contribution*((c.c-Z.contribution.m)/(Z.contribution.s||1));
      const pS=M.echelle*P.surprise*((surprise-Z.surprise.m)/(Z.surprise.s||1));
      const pN=M.echelle*P.niveau*((niv-Z.niveau.m)/(Z.niveau.s||1));
      out.push({ battleId:bid, ts:c.row.ts, accId:c.row.accId, name:c.row.name, role:c.role,
                 mapName:c.row.mapName, sr:(M.centre_sr||1500)+pC+pS+pN, pC, pS, pN, parts:c.parts });
    });
  });
  return out;
}
function srRows(){ if(!SR_ROWS) SR_ROWS=srBuild(); return SR_ROWS; }
/* SR d'UNE bataille pour un joueur (repli sur l'ancien calcul si le modèle figé
   n'est pas disponible). Sert au MVP et aux cartes de bataille. */
let SR_IDX=null;
function srBattle(r){
  if(!srOk()) return null;   // plus aucun repli : pas de modele = pas de SR
  if(!SR_IDX){ SR_IDX=new Map(); srRows().forEach(x=>SR_IDX.set(x.battleId+"|"+x.accId,x.sr)); }
  return SR_IDX.get(r.battleId+"|"+r.accId) ?? null;
}
/* Moyenne des SR par bataille : ignore les lignes sans SR et renvoie null
   si aucune n est exploitable. Aucun repli sur l ancien calcul. */
/* Texte sous le SR : rappelle que la note dépend du clan et de la saison. */
function srHint(){
  const M=SR_MODEL&&SR_MODEL["7v7"];
  return M ? "SR — saison 1 · calculé sur les batailles de ce clan"
           : "SR indisponible : modèle de saison non chargé";
}
/* Échelle des paliers : « 1712 » ne veut rien dire seul. La réglette montre où
   ce chiffre tombe, et la bande claire autour du repère rappelle que la note a
   une marge d'erreur — elle interdit de lire 20 points d'écart comme un écart. */
// Les seuils ne sont écrits qu'une fois : couleur et libellé viennent de ceTier,
// sinon les deux finiraient par se contredire.
const SR_SEUILS=[1000,1350,1650,2000,2500];
const SR_ECH_MIN=900, SR_ECH_MAX=2700;
function srScale(v,marge){
  if(v==null) return "";
  const pos=x=>Math.max(0,Math.min(100,
    (Math.max(SR_ECH_MIN,Math.min(SR_ECH_MAX,x))-SR_ECH_MIN)/(SR_ECH_MAX-SR_ECH_MIN)*100));
  const bornes=[SR_ECH_MIN,...SR_SEUILS];
  const seg=bornes.map((b,i)=>{
    const fin=i+1<bornes.length?bornes[i+1]:SR_ECH_MAX, t=ceTier(b);
    return `<div class="srs-seg" style="left:${pos(b)}%;width:${pos(fin)-pos(b)}%;background:${t.c}"
      title="${esc(t.l)} — ${fmt(b)} et plus"></div>`;
  }).join("");
  const tick=SR_SEUILS.map(b=>
    `<div class="srs-tick" style="left:${pos(b)}%"><span>${fmt(b)}</span></div>`).join("");
  const m=Math.max(0,marge||0);
  const bande=m>0?`<div class="srs-band" style="left:${pos(v-m)}%;width:${pos(v+m)-pos(v-m)}%"></div>`:"";
  return `<div class="sr-scale">
    <div class="srs-track">${seg}${bande}
      <div class="srs-mark" style="left:${pos(v)}%"></div></div>
    <div class="srs-ticks">${tick}</div>
    <div class="srs-note">${m>0?`Ton SR se situe entre <b>${fmt(v-m)}</b> et <b>${fmt(v+m)}</b> — un écart plus petit que ça ne se lit pas.`
                              :"Échelle des paliers."}</div>
  </div>`;
}
/* Décomposition : d'où viennent les points, et avec quelle certitude.
   C'est ce qui rend la note actionnable — « ma vision est faible » se travaille,
   « j'ai 1870 » ne se travaille pas. */
function srDecomp(accId){
  const s = (accId!=null && srOk()) ? srByPlayer().get(Number(accId)) : null;
  if(!s) return "";
  if(s.etat==="insuffisant")
    return `<div class="sr-note">Pas encore de SR : <b>${s.n}</b> bataille${s.n>1?"s":""} sur les 10 nécessaires.
      En dessous, la marge d'erreur dépasse les écarts qu'on cherche à mesurer.</div>`;
  const L=[["Contribution",s.pC,"ce que tu fais dans ton équipe"],
           ["Surprise",s.pS,"le résultat comparé à ce qui était prévu"],
           ["Niveau",s.pN,"la hauteur à laquelle ton clan joue"]];
  const mx=Math.max(120,...L.map(x=>Math.abs(x[1])));
  const bars=L.map(([nom,v,expl])=>{
    const w=Math.min(100,Math.abs(v)/mx*100), pos=v>=0;
    return `<div class="srd-row" title="${esc(expl)}">
      <div class="srd-lab">${nom}</div>
      <div class="srd-track"><div class="srd-fill${pos?"":" neg"}" style="width:${w.toFixed(0)}%"></div></div>
      <div class="srd-val" style="color:${pos?"var(--dv-plus)":"var(--dv-minus)"}">${pos?"+":""}${Math.round(v)}</div></div>`;
  }).join("");
  const prov = s.etat==="provisoire"
    ? `<span class="srd-tag">provisoire — ${s.n} batailles</span>` : "";
  return `<div class="sr-decomp"><div class="srd-head">D'où viennent les points ${prov}
    <span class="srd-marge">marge ±${s.marge}</span></div>${bars}</div>`;
}
/* ============================================================
   RADAR DES CINQ APTITUDES
   Chaque part est rapportée à la MÉDIANE DE SON RÔLE, bataille par bataille :
   un joueur qui alterne lourd et moyen est ainsi comparé au bon groupe à chaque
   fois. 1,00 = tu fais exactement ce qu'on attend de ton rôle.
   ============================================================ */
/* Rang de Bastion couvert par le SR. Une seule constante à changer le jour où un
   second rang est calibré — et un seul endroit à relire pour savoir ce qui est
   compté. Le jeu impose le tier en Bastion : le tier du char est celui du combat. */
const SR_TIER=10;
// Le rang vient de la BATAILLE (voir BATTLE_TIER), pas du char de la ligne :
// c est la meme regle que celle qui decide le SR, donc les deux ne peuvent pas
// diverger. Repli sur le char si la bataille est inconnue.
const estTierSR=r=>(BATTLE_TIER[r.battleId] ?? (Number((VEHMAP[r.veh]||{}).tier)>=10?10:0))===SR_TIER;
const SR_AXES=[["deg","Dégâts"],["enc","Encaissé"],["bli","Blindage"],["vis","Vision"],["obj","Objectif"]];
/* Virgule décimale : toFixed rend « 0.72 », illisible au milieu d'un texte français. */
const nb2=v=>Number(v||0).toLocaleString(window.CP_LOC,{minimumFractionDigits:2,maximumFractionDigits:2});
let SR_MED={};
/* ⚠️ La référence EXCLUT les batailles du joueur mesuré. Avec une vingtaine de
   joueurs seulement, un habitué tire la médiane vers lui et finirait par se
   comparer à lui-même — il ressortirait mécaniquement « dans la moyenne ». */
function srRoleMedians(exclAcc){
  const cle=String(exclAcc==null?"*":exclAcc);
  if(SR_MED[cle]) return SR_MED[cle];
  const par={};
  srRows().forEach(r=>{ if(!r.parts) return;
    if(exclAcc!=null && r.accId===Number(exclAcc)) return;
    const b=par[r.role]=par[r.role]||{}; SR_AXES.forEach(([k])=>{ (b[k]=b[k]||[]).push(r.parts[k]); }); });
  const out={};
  for(const role in par){ out[role]={};
    SR_AXES.forEach(([k])=>{ const v=par[role][k].slice().sort((a,b)=>a-b);
      out[role][k]= v.length ? v[Math.floor(v.length/2)] : 1; }); }
  SR_MED[cle]=out; return out;
}
/* Moyenne, pour un joueur, de chaque aptitude rapportée à la médiane de son rôle. */
function srAptitudes(accId){
  const med=srRoleMedians(accId), rs=srRows().filter(r=>r.accId===Number(accId)&&r.parts);
  if(!rs.length) return null;
  const out={};
  SR_AXES.forEach(([k])=>{
    const v=rs.map(r=>{ const m=(med[r.role]||{})[k]; return (m&&m>0.05) ? r.parts[k]/m : null; })
             .filter(x=>x!=null);
    out[k]= v.length ? v.reduce((a,b)=>a+b,0)/v.length : 1;
  });
  return { n:rs.length, val:out };
}
function srRadar(accId){
  if(accId==null||!srOk()) return "";
  const a=srAptitudes(accId); if(!a) return "";
  const M=SR_MODEL["7v7"], S=(M&&M.seuils)||{aucun:10};
  if(a.n<S.aucun) return "";
  const W=300,C=150,R=104,CAP=2;
  const ang=i=>(-90+i*(360/SR_AXES.length))*Math.PI/180;
  const rad=v=>Math.min(CAP,Math.max(0,v))/CAP*R;
  const pt=(i,v)=>[C+rad(v)*Math.cos(ang(i)), C+rad(v)*Math.sin(ang(i))];
  // toiles de fond : 0,5 / 1,0 (la référence) / 1,5
  const toile=[0.5,1,1.5].map(niv=>{
    const d=SR_AXES.map((_,i)=>{const p=pt(i,niv); return `${i?"L":"M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`;}).join(" ")+" Z";
    return `<path d="${d}" fill="none" stroke="${niv===1?"var(--accent)":"var(--border)"}"
      stroke-width="${niv===1?1.4:1}" ${niv===1?'stroke-dasharray="3 3"':""}/>`;
  }).join("");
  const axes=SR_AXES.map((_,i)=>{const p=pt(i,CAP);
    return `<line x1="${C}" y1="${C}" x2="${p[0].toFixed(1)}" y2="${p[1].toFixed(1)}" stroke="var(--border)"/>`;}).join("");
  const d=SR_AXES.map(([k],i)=>{const p=pt(i,a.val[k]); return `${i?"L":"M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`;}).join(" ")+" Z";
  const dots=SR_AXES.map(([k],i)=>{const p=pt(i,a.val[k]);
    return `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5" fill="var(--accent)"/>`;}).join("");
  // Libellés en encre neutre — le texte ne porte jamais la couleur d'une série.
  // Le signe (▲/▼) porte le sens, la couleur ne fait que le renforcer.
  const labs=SR_AXES.map(([k,nom],i)=>{const p=pt(i,CAP+0.28); const v=a.val[k];
    const sg=v>=1.15?"▲":(v<=0.85?"▼":"");
    const col=v>=1.15?"var(--dv-plus)":(v<=0.85?"var(--dv-minus)":"var(--muted)");
    return `<text x="${p[0].toFixed(1)}" y="${p[1].toFixed(1)}" text-anchor="middle"
      dominant-baseline="middle" font-size="11.5" font-weight="700" fill="var(--ink-2)">${nom}</text>
      <text x="${p[0].toFixed(1)}" y="${(p[1]+13).toFixed(1)}" text-anchor="middle"
      dominant-baseline="middle" font-size="11" fill="${col}">${sg}${nb2(v)}×</text>`;}).join("");
  // survol : chaque sommet expose sa valeur et sa lecture
  const zones=SR_AXES.map(([k,nom],i)=>{const p=pt(i,a.val[k]); const v=a.val[k];
    const lec=v>=1.15?"au-dessus de l'attendu":(v<=0.85?"en dessous de l'attendu":"conforme à l'attendu");
    return `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="13" fill="transparent"
      style="cursor:help"><title>${nom} : ${nb2(v)}× la médiane de ton rôle — ${lec}</title></circle>`;}).join("");
  // le point fort et le point faible, nommés
  const tri=SR_AXES.map(([k,nom])=>({nom,v:a.val[k]})).sort((x,y)=>y.v-x.v);
  return `<div class="sr-radar">
    <div class="srd-head">Tes aptitudes <span class="srd-tag">comparé à ton rôle</span></div>
    <div class="srr-body">
      <svg viewBox="0 0 ${W} ${W}" style="width:100%;max-width:300px;height:auto">
        ${axes}${toile}
        <path d="${d}" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
        ${dots}${labs}${zones}
      </svg>
      <div class="srr-txt">
        <p><b style="color:var(--dv-plus)">${tri[0].nom}</b> est ton point fort — ${nb2(tri[0].v)}× la médiane de ton rôle.</p>
        <p class="srr-hint">Le pointillé doré est le niveau attendu pour ton rôle. Au-delà, tu fais
        plus que ta part ; en deçà, moins.</p>
        <p class="srr-hint">Ton point faible est traité dans le plan de progression, à côté — il
        n'est pas répété ici.</p>
      </div>
    </div></div>`;
}

/* ============================================================
   COURBE DE PROGRESSION
   Le SR d'UNE bataille est très bruité (±500) : tracé brut, il ressemblerait à
   un électrocardiogramme et ne montrerait aucune tendance. On trace donc une
   MOYENNE GLISSANTE sur 10 batailles, avec les batailles individuelles en fond
   pour que la dispersion reste visible — et non masquée par le lissage.
   ============================================================ */
const SR_FENETRE=10;
function srCurve(accId,largeur){
  if(accId==null||!srOk()) return "";
  const rs=srRows().filter(r=>r.accId===Number(accId)&&r.ts).sort((a,b)=>a.ts-b.ts);
  if(rs.length<SR_FENETRE)
    return `<div class="sr-note">Courbe disponible à partir de ${SR_FENETRE} batailles
      — tu en as <b>${rs.length}</b>.</div>`;
  // moyenne glissante : chaque point résume les 10 dernières batailles
  const pts=[];
  for(let i=SR_FENETRE-1;i<rs.length;i++){
    let s=0; for(let j=i-SR_FENETRE+1;j<=i;j++) s+=rs[j].sr;
    pts.push({ x:i, y:s/SR_FENETRE, ts:rs[i].ts });
  }
  // Le dessin est fait À LA LARGEUR RÉELLE de la carte, comme renderTrend : sinon
  // le SVG se met à l'échelle et emporte les libellés avec lui — étirés à
  // l'horizontale avec preserveAspectRatio="none", surdimensionnés sans.
  // 36 = marge interne gauche + droite de la carte.
  const W=Math.max(360,Math.round((largeur||556)-36)),H=190,L=44,R=12,T=14,B=26;
  const ys=[...rs.map(r=>r.sr),...pts.map(p=>p.y),1500];
  let y0=Math.min(...ys), y1=Math.max(...ys);
  const pad=(y1-y0)*0.12||100; y0-=pad; y1+=pad;
  const px=i=>L+(rs.length<2?0:i/(rs.length-1))*(W-L-R);
  const py=v=>T+(1-(v-y0)/((y1-y0)||1))*(H-T-B);
  // batailles individuelles en fond : la dispersion réelle reste lisible
  const dots=rs.map((r,i)=>`<circle cx="${px(i).toFixed(1)}" cy="${py(r.sr).toFixed(1)}" r="2"
     fill="var(--muted)" opacity=".45"/>`).join("");
  const d=pts.map((p,i)=>`${i?"L":"M"}${px(p.x).toFixed(1)} ${py(p.y).toFixed(1)}`).join(" ");
  const ref=py(1500);
  const dernier=pts[pts.length-1], premier=pts[0];
  const delta=Math.round(dernier.y-premier.y);
  const dateFR=t=>{ try{ return new Date(t*1000).toLocaleDateString(window.CP_LOC,{day:"2-digit",month:"short"}); }catch(_){ return ""; } };
  return `<div class="sr-curve">
    <div class="srd-head">Progression <span class="srd-tag">moyenne sur ${SR_FENETRE} batailles</span>
      <span class="srd-marge" style="color:${delta>=0?"var(--dv-plus)":"var(--dv-minus)"}">${delta>=0?"+":""}${delta} depuis le début</span></div>
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">
      <line x1="${L}" x2="${W-R}" y1="${ref.toFixed(1)}" y2="${ref.toFixed(1)}"
            stroke="var(--border)" stroke-dasharray="4 4"/>
      <text x="${L-6}" y="${(ref+4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--muted)">1500</text>
      <text x="${L-6}" y="${(py(y1)+12).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--muted)">${Math.round(y1)}</text>
      <text x="${L-6}" y="${py(y0).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--muted)">${Math.round(y0)}</text>
      ${dots}
      <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${px(dernier.x).toFixed(1)}" cy="${py(dernier.y).toFixed(1)}" r="4" fill="var(--accent)"/>
      <text x="${L}" y="${H-8}" font-size="11" fill="var(--muted)">${dateFR(rs[0].ts)}</text>
      <text x="${W-R}" y="${H-8}" text-anchor="end" font-size="11" fill="var(--muted)">${dateFR(rs[rs.length-1].ts)}</text>
    </svg>
    <div class="srd-legend">Les points gris sont tes batailles une à une ; la ligne est leur moyenne glissante.</div>
  </div>`;
}
function srAvg(rows){ const v=(rows||[]).map(srBattle).filter(x=>x!=null);
  return v.length ? Math.round(v.reduce((a,b)=>a+b,0)/v.length) : null; }
/* Agrégat par joueur, avec lissage bayésien et RÈGLES D'AFFICHAGE :
   en dessous de 10 batailles on n'affiche rien — l'erreur type dépasse alors
   l'écart réel entre joueurs, le chiffre ne voudrait rien dire. */
function srByPlayer(){
  const M=SR_MODEL&&SR_MODEL["7v7"]; if(!M) return new Map();
  const S=M.seuils||{aucun:10,provisoire:20};
  const g=new Map();
  srRows().forEach(r=>{ const a=g.get(r.accId); if(a) a.push(r); else g.set(r.accId,[r]); });
  /* ⭐ LISSAGE SUR LA SEULE PART ATTRIBUABLE AU JOUEUR (contribution + surprise).
     Le terme de niveau décrit le CONTEXTE dans lequel il joue, pas sa performance :
     le ramener vers la moyenne n'aurait aucun sens.
     Le m fourni par le modèle (1,6) est calculé sur un τ global gonflé par les
     écarts ENTRE CLANS ; à l'intérieur d'un clan le niveau est presque constant,
     donc l'écart réel entre coéquipiers est bien plus faible et le lissage doit
     être bien plus fort. On le recalcule ici sur la bonne quantité. */
  const perso=r=>r.pC+r.pS;
  let ss=0, ddl=0; const moyennes=[];
  g.forEach(rs=>{
    const mu=rs.reduce((a,r)=>a+perso(r),0)/rs.length;
    moyennes.push({mu,n:rs.length});
    if(rs.length>1){ rs.forEach(r=>{ ss+=Math.pow(perso(r)-mu,2); }); ddl+=rs.length-1; }
  });
  const sig=Math.sqrt(ddl>0?ss/ddl:Math.pow(M.sigma||500,2));
  const assez=moyennes.filter(x=>x.n>=5);
  const mm=assez.length?assez.reduce((a,x)=>a+x.mu,0)/assez.length:0;
  const varObs=assez.length>1?assez.reduce((a,x)=>a+Math.pow(x.mu-mm,2),0)/(assez.length-1):0;
  const varBruit=assez.length?assez.reduce((a,x)=>a+sig*sig/x.n,0)/assez.length:0;
  const tau=Math.sqrt(Math.max(1,varObs-varBruit));
  const m=Math.max(1,Math.min(60,(sig*sig)/(tau*tau)));
  /* ⭐ NIVEAU = CELUI DU CLAN, pas celui de chaque bataille.
     Calculé par bataille, ce terme récompensait « avoir joué les soirs où le clan
     affrontait du lourd » — un joueur à 5 batailles tombé sur les grosses soirées
     dominait le classement. Or l'objectif est de séparer LES CLANS entre eux, pas
     les soirées d'un même clan. Tous les membres partagent donc le même socle,
     et à l'intérieur du clan seuls la contribution et la surprise départagent. */
  const tous=srRows();
  const pNclan=tous.length? tous.reduce((a,r)=>a+r.pN,0)/tous.length : 0;
  const out=new Map();
  g.forEach((rs,acc)=>{
    const n=rs.length, avg=k=>rs.reduce((a,r)=>a+r[k],0)/n;
    const pC=avg("pC"), pS=avg("pS");
    /* PAS DE LISSAGE. Il n'écrase pas les différences par principe — il traduit la
       méfiance envers un petit échantillon — mais le seuil d'affichage (rien en
       dessous de 10 batailles) joue déjà ce rôle. Cumuler les deux reviendrait à
       se protéger deux fois et à gommer des écarts réels chez ceux qu'on affiche.
       On montre donc la vraie valeur, accompagnée de sa marge d'erreur. */
    out.set(acc,{ n, brut:1500+pC+pS+avg("pN"), sr:1500+pNclan+pC+pS,
                  pC, pS, pN:pNclan,
                  marge: Math.round(sig/Math.sqrt(n)), lissage:Number(m.toFixed(1)),
                  etat: n<S.aucun?"insuffisant":(n<S.provisoire?"provisoire":"ok") });
  });
  return out;
}
function aggregate(rows){
  // Clé par ID DE COMPTE (pas le pseudo) : un joueur qui se renomme garde ses stats.
  const nameById={}; (MEMBERS||[]).forEach(mb=>{ if(mb.account_id!=null) nameById[Number(mb.account_id)]=mb.nickname; });
  const m={};
  for(const r of rows){
    const key=(r.accId!=null)?("id"+r.accId):("nm|"+String(r.name));
    let a=m[key];
    if(!a){ a=m[key]={accId:r.accId,name:r.name,_lts:-1,battles:new Set(),wins:new Set(),dmg:0,kills:0,assist:0,spot:0,xp:0,surv:0,block:0,dmgr:0,obj:0,ce:0,n:0}; }
    if((r.ts||0)>a._lts){ a._lts=r.ts||0; a.name=r.name; }   // conserve le pseudo le plus récent
    a.battles.add(r.battleId); if(r.result===1) a.wins.add(r.battleId);
    a.dmg+=r.dmg;a.kills+=r.kills;a.assist+=r.assist;a.spot+=r.spot;a.xp+=r.xp;a.surv+=(r.surv?1:0);
    a.block+=r.block;a.dmgr+=r.dmgr;a.obj+=(r.cap||0)+(r.decap||0);a.n++;
  }
  return Object.values(m).map(a=>({
    accId:a.accId,
    name:(a.accId!=null && nameById[a.accId]) ? nameById[a.accId] : a.name,   // pseudo courant du roster sinon le plus récent
    battles:a.battles.size,
    winrate:a.battles.size?a.wins.size/a.battles.size:0,
    dmg:a.n?a.dmg/a.n:0,kills:a.n?a.kills/a.n:0,assist:a.n?a.assist/a.n:0,
    spot:a.n?a.spot/a.n:0,survrate:a.n?a.surv/a.n:0,xp:a.n?a.xp/a.n:0,
    block:a.n?a.block/a.n:0,dmgr:a.n?a.dmgr/a.n:0,obj:a.n?a.obj/a.n:0,
    // SR SAISON 1 dès que le modèle figé est disponible, ancien calcul en repli.
    // On expose aussi la décomposition, la marge d'erreur et l'état
    // (insuffisant / provisoire / ok) : c'est ce qui pilotera l'affichage.
    ...(function(){
      const s = srOk() ? srByPlayer().get(a.accId) : null;
      if(!s) return { ce:null, srEtat:"indisponible" };   // pas de modele = pas de SR
      // Pas assez de batailles -> AUCUN SR. `ce` vaut null et tous les affichages
      // montrent « — » : mieux vaut ne rien dire que d'annoncer un chiffre dont la
      // marge d'erreur dépasse les écarts qu'on cherche à mesurer.
      return { ce: s.etat==="insuffisant" ? null : Math.round(s.sr),
               srBrut: Math.round(s.brut), srNb: s.n,
               srMarge: s.marge, srEtat: s.etat,
               srC: Math.round(s.pC), srS: Math.round(s.pS), srN: Math.round(s.pN) };
    })(),
  }));
}
function ceTier(v){
  // v === null : le joueur n'a pas encore assez de batailles pour un SR fiable.
  if(v==null) return {c:"var(--muted)",l:"Pas encore assez de batailles"};
  if(v>=2500) return {c:"#a970ff",l:"Pilier d'équipe"};
  if(v>=2000) return {c:"var(--good)",l:"Très bon coéquipier"};
  if(v>=1650) return {c:"#4f97ee",l:"Bon coéquipier"};
  if(v>=1350) return {c:"var(--ink-2)",l:"Dans la moyenne du clan"};
  if(v>=1000) return {c:"var(--accent)",l:"En retrait"};
  return {c:"var(--bad)",l:"À renforcer"};
}
function ceBadge(v){ const t=ceTier(v);
  if(v==null) return `<span class="ce-badge" style="color:${t.c}" title="${esc(t.l)}">—</span>`;
  return `<span class="ce-badge" style="color:${t.c}" title="${esc(t.l)}">${fmt(v)}</span>`; }
function fmt(n,d=0){ return (n||0).toLocaleString(window.CP_LOC,{maximumFractionDigits:d,minimumFractionDigits:d}); }
function pct(x){ return Math.round((x||0)*100)+"%"; }
function esc(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
const CP_EMBLEM='<circle cx="120" cy="120" r="100" fill="none" stroke="#d8b566" stroke-width="7"/><circle cx="120" cy="120" r="88" fill="none" stroke="#d8b566" stroke-width="2.5" opacity=".5"/><rect x="81" y="8" width="18" height="18" fill="#d8b566"/><rect x="111" y="4" width="18" height="18" fill="#d8b566"/><rect x="141" y="8" width="18" height="18" fill="#d8b566"/><path d="M161,155 A54,54 0 1 1 161,85" fill="none" stroke="#d8b566" stroke-width="20" stroke-linecap="round"/><rect x="112" y="94" width="16" height="52" rx="5" fill="#d8b566"/><rect x="94" y="112" width="52" height="16" rx="5" fill="#d8b566"/>';
function cpLoader(txt){
  return '<div class="cp-load"><div class="cp-load-mark">'
    +'<svg viewBox="0 0 120 120" class="cp-spin" aria-hidden="true"><circle cx="60" cy="60" r="54"/></svg>'
    +'<svg viewBox="0 0 240 240" class="cp-emb" aria-hidden="true">'+CP_EMBLEM+'</svg>'
    +'</div><div class="cp-load-txt">'+esc(txt||"Chargement…")+'</div></div>';
}

function render(){
  const all=applyFilters();
  const rows=all.filter(r=>r.isMember);   // vue clan = uniquement les membres du clan
  const agg=aggregate(rows);
  const battleIds=new Set(rows.map(r=>r.battleId));
  renderDashboard();
  renderTable(agg);
  const fc=document.getElementById("footCount"); if(fc) fc.textContent=rows.length+" lignes · "+battleIds.size+" batailles";
}
function renderBars(id,list,key,f){
  const el=document.getElementById(id);
  if(!el) return;
  if(!list.length){ el.innerHTML='<div class="empty">Aucune donnée</div>'; return; }
  const max=Math.max(...list.map(x=>x[key]))||1;
  el.innerHTML=list.map(x=>{ const w=Math.max(3,x[key]/max*100);
    return `<div class="bar-row" title="${esc(x.name)} — ${f(x[key])}"><div class="nm">${esc(x.name)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${w}%"></div></div>
      <div class="vv">${f(x[key])}</div></div>`; }).join("");
}
function renderTrend(rows){
  const svg=document.getElementById("trend");
  // Le gestionnaire de redimensionnement appelle cette fonction meme depuis un
  // autre onglet, ou #trend n'est pas dans la page -> il plantait sur clientWidth.
  if(!svg) return;
  const W=svg.clientWidth||900,H=190,padL=34,padR=12,padT=14,padB=26;
  const perDay={};
  rows.forEach(r=>{ if(!r.ts)return; const d=new Date(r.ts*1000);
    const key=d.getFullYear()+"-"+(d.getMonth()+1)+"-"+d.getDate();
    (perDay[key]=perDay[key]||new Set()).add(r.battleId); });
  let days=Object.keys(perDay).map(k=>({k,t:new Date(k).getTime(),n:perDay[k].size})).sort((a,b)=>a.t-b.t);
  if(days.length<2){ svg.innerHTML=`<text x="${W/2}" y="${H/2}" text-anchor="middle">Pas assez de jours pour une tendance</text>`; return; }
  const maxN=Math.max(...days.map(d=>d.n));
  const x=i=>padL+i/(days.length-1)*(W-padL-padR), y=v=>padT+(1-v/maxN)*(H-padT-padB);
  let g="";
  for(let i=0;i<=maxN;i++){ const yy=y(i);
    g+=`<line class="grid-line" x1="${padL}" y1="${yy}" x2="${W-padR}" y2="${yy}"/>`;
    g+=`<text x="${padL-6}" y="${yy+3}" text-anchor="end">${i}</text>`; }
  let path="",area="M"+padL+","+(H-padB);
  days.forEach((d,i)=>{ const px=x(i),py=y(d.n); path+=(i?"L":"M")+px+","+py+" "; area+="L"+px+","+py+" "; });
  area+="L"+x(days.length-1)+","+(H-padB)+" Z";
  g+=`<path class="area" d="${area}"/><path class="line" d="${path}"/>`;
  days.forEach((d,i)=>{ g+=`<circle class="dot" cx="${x(i)}" cy="${y(d.n)}" r="3"><title>${d.k} : ${d.n}</title></circle>`; });
  [0,Math.floor((days.length-1)/2),days.length-1].forEach(i=>{
    const lab=new Date(days[i].t).toLocaleDateString(window.CP_LOC,{day:"2-digit",month:"2-digit"});
    g+=`<text x="${x(i)}" y="${H-8}" text-anchor="middle">${lab}</text>`; });
  g+=`<line class="axis-line" x1="${padL}" y1="${H-padB}" x2="${W-padR}" y2="${H-padB}"/>`;
  svg.innerHTML=g;
}
const COLS=[
  {k:"name",t:"Joueur",f:v=>esc(v)},
  {k:"ce",t:"SR",f:v=>ceBadge(v)},
  {k:"battles",t:"Batailles",f:v=>fmt(v)},
  {k:"winrate",t:"% Vict.",f:v=>pct(v),cls:v=>v>=0.5?"pos":"neg"},
  {k:"dmg",t:"Dég. moy",f:v=>fmt(v)},
  {k:"kills",t:"Frags",f:v=>fmt(v,2)},
  {k:"assist",t:"Assist",f:v=>fmt(v)},
  {k:"spot",t:"Repérage",f:v=>fmt(v,1)},
  {k:"survrate",t:"% Survie",f:v=>pct(v)},
  {k:"xp",t:"XP moy",f:v=>fmt(v)},
];
const COLS2=[
  {k:"ce",t:"SR",f:v=>`<span class="pr" style="color:${srColor(v)}">${fmt(v)}</span>`},
  {k:"battles",t:"Bat.",f:v=>fmt(v)},
  {k:"winrate",t:"% vic.",f:v=>pct(v),cls:v=>v>=0.5?"pos":"neg"},
  {k:"dmg",t:"Dég. moy",f:v=>fmt(v)},
  {k:"kills",t:"Frags",f:v=>fmt(v,2)},
];
function renderTable(agg){
  const thead=document.getElementById("thead"); if(!thead) return;
  if(!COLS2.some(c=>c.k===state.sortKey)) state.sortKey="ce";
  thead.innerHTML=`<th class="rk">#</th><th>Joueur</th>`+COLS2.map(c=>{ const on=c.k===state.sortKey; const arw=on?(state.sortDir<0?" ▼":" ▲"):"";
    return `<th data-k="${c.k}" class="${on?'sorted':''}">${c.t}${arw}</th>`; }).join("");
  thead.querySelectorAll("th[data-k]").forEach(th=>th.onclick=()=>{
    const k=th.dataset.k;
    if(state.sortKey===k) state.sortDir*=-1; else { state.sortKey=k; state.sortDir=-1; }
    render();
  });
  const sorted=agg.slice().sort((a,b)=>state.sortDir*((a[state.sortKey]||0)-(b[state.sortKey]||0))).slice(0,10);   // top 10 seulement
  const tb=document.getElementById("tbody");
  if(!sorted.length){ tb.innerHTML=`<tr><td colspan="7" style="color:var(--muted);text-align:center;padding:16px">Aucune bataille enregistrée pour cette période</td></tr>`; return; }
  tb.innerHTML=sorted.map((row,i)=>{
    const av=`<span class="av">${esc(String(row.name||'?')[0].toUpperCase())}</span>`;
    return `<tr><td class="rk">${i+1}</td><td><span class="pn">${av}${esc(shortName(row.name))}</span></td>`
      +COLS2.map(c=>{ const v=row[c.k]; return `<td class="${c.cls?c.cls(v):''}">${c.f(v)}</td>`; }).join("")+`</tr>`;
  }).join("");
}

/* ============================================================
   UI
   ============================================================ */
function rebuildFilters(){
  const mm=new Set(); RAW.forEach(r=>{ if(r.mode) mm.add(r.mode); });
  document.getElementById("modeSel").innerHTML=`<option value="">Tous</option>`+[...mm].sort().map(m=>`<option>${esc(m)}</option>`).join("");
}
/* Sur index.html la vue joueur n'existe plus ; sur progression.html elle
   est la seule et toujours affichée. Le test vaut pour les deux pages. */
function playerActive(){ const e=document.getElementById("viewPlayer");
  return !!e && !e.classList.contains("hidden"); }
function battlesActive(){ return !document.getElementById("viewBattles").classList.contains("hidden"); }
function rerender(){ render(); if(playerActive()) renderPlayerView(); if(battlesActive()) renderBattles(); }
function wireUI(){
  document.querySelectorAll(".cv-tab").forEach(b=>b.onclick=()=>switchClanSub(b.dataset.sub));
  document.getElementById("modeSel").onchange=e=>{state.mode=e.target.value;rerender();};
  { const _s=document.getElementById("search"); if(_s) _s.oninput=e=>{state.search=e.target.value;render();}; }
  document.getElementById("periodSeg").querySelectorAll("button").forEach(b=>b.onclick=()=>{
    document.getElementById("periodSeg").querySelectorAll("button").forEach(x=>x.classList.remove("on"));
    b.classList.add("on"); state.days=parseInt(b.dataset.d,10); rerender();
  });
  document.querySelectorAll("#nav .tab").forEach(t=>t.onclick=()=>switchView(t.dataset.v));
  document.getElementById("playerSel").onchange=e=>{ SELP=Number(e.target.value); renderPlayerView(); };
  document.getElementById("clanSearchBtn").onclick=searchClans;
  document.getElementById("clanQuery").addEventListener("keydown",e=>{ if(e.key==="Enter") searchClans(); });
  document.getElementById("luNewBtn").onclick=()=>openLineupEditor(null);
  document.getElementById("loNewBtn").onclick=()=>openLoadoutEditor(null);
  document.getElementById("tlNewBtn").onclick=()=>openTierlistEditor(null);
  document.getElementById("stNewBtn").onclick=()=>openStratEditor(null);
  document.querySelectorAll(".lo-subtab").forEach(b=>b.onclick=()=>switchLoSub(b.dataset.losub));
  document.getElementById("sideToggle").onclick=toggleSidebar;
  // (classement : le module #clanRanking construit son propre sélecteur)
  { const _tb=document.getElementById("themeBtn"); if(_tb) _tb.style.display="none"; }  // thème sombre uniquement
  document.getElementById("logoutBtn").onclick=()=>{ localStorage.removeItem(LS_SESSION); location.href=redirectUri(); };
  window.addEventListener("resize",()=>{ if(document.getElementById("app").classList.contains("hidden"))return;
    if(playerActive()) renderPlayerView(); else renderTrend(applyFilters().filter(r=>r.isMember)); });
}

/* ============================================================
   VUE "MA PROGRESSION" (analyse individuelle)
   ============================================================ */
function fmtTime(sec){ sec=Math.round(sec||0); const m=Math.floor(sec/60),s=sec%60; return m+":"+(s<10?"0":"")+s; }
function prettyMap(s){ s=String(s||""); if(!s) return "?";
  /* La table du jeu d'abord : « prohorovka » est un nom de fichier,
     « Prokhorovka » est le nom de la carte. Onze cartes y ont en plus
     leur nom français — Toundra, Falaise, Carélie.
     Le try/catch n'est pas de la superstition : LU_MAPS est déclaré plus
     bas dans le même script. Il est atteignable au moment où l'on rend
     une vue, mais un nom de carte n'a pas à faire tomber la page. */
  try{ const k=s.toLowerCase().replace(/[^a-z]/g,"");
       const e=LU_MAPS.find(x=>x[0]===k); if(e && e[1]) return e[1]; }catch(_){}
  s=s.replace(/^\d+_/,"").replace(/_/g," ");
  return s.replace(/\b\w/g,c=>c.toUpperCase()); }
function clsFR(c){ return ({heavyTank:"Lourd",mediumTank:"Moyen",lightTank:"Léger","AT-SPG":"Chasseur (TD)",SPG:"Artillerie"})[c]||c||"—"; }
/* ⚠️ Le tier fait partie du filtre, au même titre que le mode : « Ma progression »
   ne montre que le rang couvert par le SR. Sans ça, les KPI, les records et les
   chars porteraient sur des batailles que la note, elle, ne compte pas. */
function pfilter(){ const now=Date.now()/1000;
  return r=>estTierSR(r)&&(!state.mode||r.mode===state.mode)&&(!(state.days)|| !r.ts || (now-r.ts)<=state.days*86400); }
function battlesWinrate(rows){ const seen={}; let w=0,t=0;
  rows.forEach(r=>{ if(!(r.battleId in seen)){ seen[r.battleId]=1; if(r.result===1)w++; if(r.result!==-1&&r.result!=null)t++; } });
  return {w,t,wr:t?w/t:0,battles:Object.keys(seen).length}; }
function avgOf(rows,k){ return rows.length?rows.reduce((s,r)=>s+r[k],0)/rows.length:0; }

function playerCE(rows){ return srAvg(rows); }
function pStreak(rows){
  const b={}; rows.forEach(r=>{ if(!(r.battleId in b)) b[r.battleId]={ts:r.ts,res:r.result}; });
  const arr=Object.values(b).sort((a,c)=>c.ts-a.ts);
  if(!arr.length) return null;
  const res=arr[0].res; let n=0; for(const x of arr){ if(x.res===res) n++; else break; }
  return {res,n};
}
function pSRTrend(rows){
  const s=rows.slice().filter(r=>r.ts).sort((a,c)=>a.ts-c.ts);
  if(s.length<6) return null;
  const h=Math.floor(s.length/2), ce=rs=>srAvg(rs);
  const older=Math.round(ce(s.slice(0,h))), recent=Math.round(ce(s.slice(h)));
  return {older,recent,delta:recent-older};
}
/* ============================================================
   LE MOIS ÉCOULÉ, COMPARÉ AU PRÉCÉDENT
   La courbe SR répond « est-ce que je progresse » sur toute la saison ; ce bloc
   y répond sur l'échelle que le joueur ressent vraiment. Les deux fenêtres font
   30 jours chacune, et on refuse de conclure sous PD_MIN batailles : en dessous,
   l'écart affiché serait du bruit et se lirait comme un progrès.
   ============================================================ */
const PD_MIN=5, PD_J=86400;
const PD_MESURES=[
  ["SR",          rs=>srAvg(rs),                  v=>fmt(v),      0],
  ["Dégâts",      rs=>avgOf(rs,"dmg"),            v=>fmt(v),      0],
  ["Victoires",   rs=>battlesWinrate(rs).wr*100,  v=>Math.round(v)+" %", 1],
  ["Encaissé",    rs=>avgOf(rs,"dmgr"),           v=>fmt(v),      0],
  ["Assistance",  rs=>avgOf(rs,"assist"),         v=>fmt(v),      0],
  ["Survie",      rs=>rs.length?rs.reduce((s,r)=>s+(r.surv?1:0),0)/rs.length*100:0,
                                                  v=>Math.round(v)+" %", 1],
];
function pDiff30(rows){
  const now=Date.now()/1000;
  const rec=rows.filter(r=>r.ts && now-r.ts<=30*PD_J);
  const pre=rows.filter(r=>r.ts && now-r.ts>30*PD_J && now-r.ts<=60*PD_J);
  if(rec.length<PD_MIN)
    return `<div class="card"><h2>Les 30 derniers jours</h2>
      <div class="sr-note">Seulement <b>${rec.length}</b> bataille${rec.length>1?"s":""} sur les 30 derniers
      jours. Il en faut au moins ${PD_MIN} pour qu'une comparaison veuille dire quelque chose.</div></div>`;
  const compar = pre.length>=PD_MIN;
  const tuiles=PD_MESURES.map(([nom,calc,form,dec])=>{
    const a=calc(rec), b=compar?calc(pre):null;
    if(a==null) return "";
    let chip=`<div class="pd-d pd-nil">—</div>`;
    if(compar && b!=null){
      const d=a-b, seuil=Math.abs(b)*0.02;            // 2 % : en deçà, c'est stable
      const cls=Math.abs(d)<=seuil?"pd-flat":(d>0?"pd-up":"pd-down");
      const sg=Math.abs(d)<=seuil?"=":(d>0?"▲ +":"▼ ");
      chip=`<div class="pd-d ${cls}">${sg}${Math.abs(d)<=seuil?"":form(Math.abs(d)).replace(/\s?%/,dec?" pt":"")}</div>`;
    }
    return `<div class="pd-t"><div class="pd-l">${nom}</div>
      <div class="pd-v">${form(a)}</div>${chip}</div>`;
  }).join("");
  return `<div class="card"><h2>Les 30 derniers jours
      <span class="hint">${rec.length} bataille${rec.length>1?"s":""}${compar?` · comparé aux ${pre.length} des 30 jours précédents`:""}</span></h2>
    <div class="pd-grid">${tuiles}</div>
    ${compar?"":`<div class="srd-legend">Pas encore 30 jours de données avant cette période : rien à comparer pour l'instant.</div>`}</div>`;
}
/* ============================================================
   RECORDS PERSONNELS
   Le SR dit où on en est en moyenne ; les records disent de quoi on est capable.
   Chacun est daté et rattaché à un char et une carte — un record sans contexte
   ne s'explique pas et ne se rejoue pas.
   ============================================================ */
const PR_CHAMPS=[
  ["dmg",   "Dégâts infligés"],
  ["block", "Blindage encaissé"],
  ["assist","Dégâts assistés"],
  ["spot",  "Dégâts par repérage"],
  ["kills", "Frags"],
  ["xp",    "Expérience"],
];
function pRecords(rows){
  const ok=rows.filter(r=>r.ts);
  if(ok.length<3) return "";
  const now=Date.now()/1000;
  const carte=(cle,nom,form)=>{
    let best=null;
    ok.forEach(r=>{ const v=cle==="sr"?srBattle(r):r[cle];
      if(v!=null && v>0 && (!best||v>best.v)) best={v,r}; });
    if(!best) return "";
    const r=best.r, frais=now-r.ts<=30*PD_J;
    const d=new Date(r.ts*1000).toLocaleDateString(window.CP_LOC,{day:"2-digit",month:"short",year:"2-digit"});
    return `<div class="pr-t${frais?" pr-new":""}">
      <div class="pr-l">${nom}${frais?`<span class="pr-tag">nouveau</span>`:""}</div>
      <div class="pr-v">${form?form(best.v):fmt(best.v)}</div>
      <div class="pr-ctx">${esc(r.tank||"?")} · ${esc(prettyMap(r.mapName))} · ${d}</div></div>`;
  };
  const cartes=[
    ...(srOk()?[carte("sr","Meilleure bataille (SR)")]:[]),
    ...PR_CHAMPS.map(([k,n])=>carte(k,n)),
  ].filter(Boolean).join("");
  if(!cartes) return "";
  return `<div class="card"><h2>Tes records
      <span class="hint">sur les ${ok.length} batailles enregistrées</span></h2>
    <div class="pr-grid">${cartes}</div></div>`;
}
/* ============================================================
   TES CHARS EN BASTION
   La seule décision que le joueur prend AVANT la bataille : lequel amener.
   On la traite avec la marge d'erreur, parce qu'avec huit batailles par char
   l'écart entre deux chars est le plus souvent du bruit — et un classement
   affiché sans marge se lit comme une vérité.
   ============================================================ */
const PT_MIN=6;
function pTanks(rows){
  const vals=[], par={};
  rows.forEach(r=>{ const v=srBattle(r); if(v==null||!r.tank) return;
    vals.push(v); (par[r.tank]=par[r.tank]||[]).push({v,dmg:r.dmg}); });
  if(vals.length<12) return "";
  // Écart-type commun : avec 6 à 15 batailles par char, un écart-type calculé
  // char par char serait lui-même trop instable pour servir de marge.
  const moy=vals.reduce((a,b)=>a+b,0)/vals.length;
  const sd=Math.sqrt(vals.reduce((s,v)=>s+(v-moy)*(v-moy),0)/Math.max(1,vals.length-1));
  const L=Object.keys(par).map(t=>{ const a=par[t];
    return { tank:t, n:a.length, sr:a.reduce((s,x)=>s+x.v,0)/a.length,
             dmg:a.reduce((s,x)=>s+x.dmg,0)/a.length, marge:Math.round(sd/Math.sqrt(a.length)) }; });
  const retenus=L.filter(x=>x.n>=PT_MIN).sort((a,b)=>b.sr-a.sr);
  const ecartes=L.length-retenus.length;
  if(!retenus.length)
    return `<div class="card"><h2>Tes chars en Bastion</h2>
      <div class="sr-note">Aucun char n'atteint ${PT_MIN} batailles enregistrées. En dessous,
      le SR d'un char est trop incertain pour être comparé à un autre.</div></div>`;
  const lo=Math.min(...retenus.map(x=>x.sr-x.marge)), hi=Math.max(...retenus.map(x=>x.sr+x.marge));
  const pos=v=>hi>lo?((v-lo)/(hi-lo))*100:50;
  const lignes=retenus.map(x=>`<div class="pt-r">
      <div class="pt-n">${esc(x.tank)}</div>
      <div class="pt-b"><div class="pt-band" style="left:${pos(x.sr-x.marge).toFixed(1)}%;width:${(pos(x.sr+x.marge)-pos(x.sr-x.marge)).toFixed(1)}%"></div>
        <div class="pt-dot" style="left:${pos(x.sr).toFixed(1)}%"></div></div>
      <div class="pt-v">${fmt(x.sr)}<span class="pt-m">±${x.marge}</span></div>
      <div class="pt-c">${x.n} bat.</div></div>`).join("");
  // Verdict : on ne nomme un meilleur char que si son intervalle ne recoupe pas
  // celui du dernier. Sinon on le dit — c'est le seul message honnête.
  const a=retenus[0], z=retenus[retenus.length-1];
  const net = retenus.length>1 && (a.sr-a.marge) > (z.sr+z.marge);
  const verdict = retenus.length<2
    ? `Un seul char atteint ${PT_MIN} batailles pour l'instant.`
    : net ? `Ton meilleur char en Bastion est le <b>${esc(a.tank)}</b> (${fmt(a.sr)} sur ${a.n} batailles), devant le <b>${esc(z.tank)}</b> (${fmt(z.sr)}). L'écart dépasse la marge d'erreur : il est réel.`
          : `Les écarts entre tes chars ne dépassent pas la marge d'erreur — sur ces volumes, aucun ne se détache vraiment. Joue celui que tu maîtrises le mieux.`;
  return `<div class="card"><h2>Tes chars en Bastion
      <span class="hint">SR moyen · ${PT_MIN} batailles minimum${ecartes?` · ${ecartes} char${ecartes>1?"s":""} écarté${ecartes>1?"s":""}`:""}</span></h2>
    <div class="pt-list">${lignes}</div>
    <div class="srd-legend">${verdict}</div></div>`;
}

/* ── Les fiches pédagogiques ───────────────────────────────────────
   Une par geste. Le « pourquoi » est toujours ramené au Bastion : en
   7 contre 7, chaque char pèse un septième de l'équipe, ce qui change
   complètement la valeur d'une erreur par rapport à une partie
   aléatoire à 15. */
const COACH_FICHES = {
  precis:{
    quoi:"La part de tes obus qui touchent quelque chose.",
    pourquoi:"En Bastion tu tires peu : entre deux obus il se passe 8 à 12 secondes. Un obus perdu, c'est un tour de recharge offert à l'adversaire — et à sept, ça se voit tout de suite.",
    comment:["Arrête-toi complètement avant de tirer : le réticule met 2 à 3 s à se refermer.",
             "Au-delà de 300 m, passe en vue snipe et attends la fermeture totale.",
             "Ne tire pas sur une cible qui traverse : laisse-la s'arrêter ou vise où elle va."],
    repere:"80 % et plus sur un char à bonne précision. En dessous de 70 %, c'est le geste à corriger en premier."
  },
  perce:{
    quoi:"La part de tes obus touchés qui traversent réellement le blindage.",
    pourquoi:"Un rebond fait zéro. Toucher sans percer coûte exactement autant qu'un raté, mais donne l'illusion d'avoir bien joué.",
    comment:["Apprends trois points faibles par char adverse fréquent — pas trente.",
             "Vise les surfaces plates : joues de tourelle, toit de caisse, arrière.",
             "Contre un blindage frontal que tu ne perces pas, change d'angle plutôt que d'obus."],
    repere:"75 à 85 % selon le char. Sous 70 %, tu tires trop souvent dans la masse frontale."
  },
  blindage:{
    quoi:"Sur tout ce que l'adversaire t'envoie, la part que ton blindage renvoie.",
    pourquoi:"Les points de vie que tu ne perds pas restent à ton équipe. À sept, un char qui tient dix secondes de plus, c'est un obus de plus tiré par chacun derrière lui.",
    comment:["Angle ta caisse entre 30 et 45° : le blindage effectif double presque.",
             "Cherche les positions en contre-pente : seule la tourelle dépasse.",
             "Bouge légèrement pendant ta recharge, tu forces l'adversaire à viser une cible mobile."],
    repere:"40 % et plus pour un lourd, 20 % pour un moyen. Un chasseur bien placé n'a pas besoin de bloquer."
  },
  echange:{
    quoi:"Les dégâts que tu infliges pour chaque point de vie que tu perds.",
    pourquoi:"C'est la seule mesure qui dit si tes duels valaient le coup. Faire 3 000 en mourant tout de suite vaut moins que 2 000 en restant en vie.",
    comment:["Ne prends un duel que si tu tires le premier ou si tu peux rebondir.",
             "Recule derrière ton couvert après ton obus, ne reste pas exposé à recharger.",
             "Si tu ne peux ni percer ni rebondir, désengage : ce duel est perdu d'avance."],
    repere:"1,5 et plus, c'est un échange gagnant. Sous 1,0, tu perds plus que tu ne rends."
  },
  survie:{
    quoi:"Le temps que tu tiens en moyenne dans la bataille.",
    pourquoi:"Un char mort ne tire plus. En 7 contre 7, partir en premier c'est retirer un septième de la puissance de feu de ton équipe pour tout le reste de la partie.",
    comment:["Laisse le premier contact au char le mieux blindé, arrive en second.",
             "Garde toujours un chemin de repli en vue avant d'avancer.",
             "En fin de partie, ta vie vaut plus que 200 dégâts de plus."],
    repere:"Vise la durée moyenne de l'équipe. Si tu es 60 s en dessous, tu pousses trop tôt."
  },
  apport:{
    quoi:"Ce que tu rapportes par le repérage et l'assistance, rapporté à tes propres dégâts.",
    pourquoi:"Un char que tu éclaires et que trois alliés arrosent rapporte bien plus que ton seul obus. C'est le geste le plus sous-estimé du format.",
    comment:["Éclaire avant de tirer : une fois que tu as tiré, tu es repéré.",
             "Utilise les buissons à plus de 15 m de ta position de tir.",
             "Casse les chenilles quand tu ne peux pas percer : l'immobilisation vaut des dégâts alliés."],
    repere:"30 % et plus pour un moyen ou un léger. Un lourd est naturellement plus bas."
  },
};


/* ══════════════════════════════════════════════════════════════════
   ÉTATS VIDES — un compte à rebours, pas une page morte
   ══════════════════════════════════════════════════════════════════ */
/* @param etapes  [{fait, total, quoi}] — la progression vers le seuil */
function cpVide(icone, titre, texte, etapes, action){
  const barres=(etapes||[]).map(e=>{
    const p=Math.min(100, e.total? e.fait/e.total*100 : 0);
    const ok=e.fait>=e.total;
    return '<div class="cpv-e'+(ok?" ok":"")+'">'+
      '<div class="cpv-el"><span>'+esc(e.quoi)+'</span>'+
        '<b>'+fmt(e.fait)+' / '+fmt(e.total)+'</b></div>'+
      '<div class="cpv-eb"><i style="width:'+p.toFixed(0)+'%"></i></div></div>';
  }).join("");
  return '<div class="cpv">'+
    '<div class="cpv-ic">'+icone+'</div>'+
    '<h3>'+esc(titre)+'</h3>'+
    '<p>'+texte+'</p>'+
    (barres?'<div class="cpv-es">'+barres+'</div>':"")+
    (action||"")+
  '</div>';
}

/* Le clan n'a encore rien enregistré : le même message partout, avec la
   marche à suivre. C'est le premier écran d'un nouveau clan. */
function cpVideClan(){
  return cpVide("🛰",
    "Aucune bataille enregistrée pour l'instant",
    "Le site se remplit tout seul dès qu'un membre joue une bataille Bastion "+
    "avec le mod installé. Rien à faire de plus.",
    null,
    '<ol class="cpv-a">'+
      '<li><b>Installe le mod</b> — <a href="mod.html">la page de téléchargement</a> explique la manœuvre en trois étapes.</li>'+
      '<li><b>Fais-le installer par tes officiers.</b> Plus il y a de membres équipés, plus vite le clan est calibré.</li>'+
      '<li><b>Joue une bataille Bastion.</b> Elle apparaît ici dans la minute qui suit.</li>'+
    '</ol>');
}

/* ══════════════════════════════════════════════════════════════════
   COACH — six gestes mesurables, comparés au clan
   ══════════════════════════════════════════════════════════════════ */
const COACH_GESTES = [
  {
    cle:"precis", nom:"Précision", ech:"obus tirés",
    /* on somme AVANT de diviser : faire la moyenne des ratios par bataille
       donnerait le même poids à une partie de 3 obus qu'à une de 30. */
    calc:rs=>{ const t=rs.reduce((a,r)=>a+(r.shots||0),0), h=rs.reduce((a,r)=>a+(r.hits||0),0);
      return t>=40 ? {v:h/t, n:t, u:"%"} : null; },
    mieux:"haut",
    constat:(m,c)=>"Tu touches "+pctf(m)+" de tes obus, le clan "+pctf(c)+".",
    action:"Tire moins souvent en mouvement, et attends l'arrêt complet du réticule sur les tirs longs."
  },
  {
    cle:"perce", nom:"Pénétration", ech:"obus touchés",
    calc:rs=>{ const h=rs.reduce((a,r)=>a+(r.hits||0),0), p=rs.reduce((a,r)=>a+(r.pierce||0),0);
      return h>=30 ? {v:p/h, n:h, u:"%"} : null; },
    mieux:"haut",
    constat:(m,c)=>"Sur tes obus qui touchent, "+pctf(m)+" traversent le blindage — "+pctf(c)+" pour le clan.",
    action:"Tu tapes trop souvent du blindage frontal. Vise les flancs, les toits de tourelle et les points faibles plutôt que la masse."
  },
  {
    cle:"blindage", nom:"Usage du blindage", ech:"batailles",
    calc:rs=>{ const b=rs.reduce((a,r)=>a+(r.block||0),0), d=rs.reduce((a,r)=>a+(r.dmgr||0),0);
      return (b+d)>=8000 ? {v:b/(b+d), n:rs.length, u:"%"} : null; },
    mieux:"haut",
    constat:(m,c)=>"Sur ce que l'adversaire t'envoie, tu en renvoies "+pctf(m)+" — le clan "+pctf(c)+".",
    action:"Angle davantage ta caisse et expose la tourelle plutôt que les flancs. En Bastion, un char qui rebondit vaut deux chars qui tirent."
  },
  {
    cle:"echange", nom:"Échange", ech:"batailles",
    /* dégâts rendus par point de vie perdu : la mesure la plus proche de
       « est-ce que ma mort valait le coup » */
    calc:rs=>{ const d=rs.reduce((a,r)=>a+(r.dmg||0),0);
      const pv=rs.reduce((a,r)=>a+Math.max(0,(r.maxhp||0)-(r.hpleft||0)),0);
      return pv>=6000 ? {v:d/pv, n:rs.length, u:"x"} : null; },
    mieux:"haut",
    constat:(m,c)=>"Tu rends "+m.toFixed(2)+" de dégâts par point de vie perdu, le clan "+c.toFixed(2)+".",
    action:"Ne prends un duel que si tu peux tirer le premier ou rebondir. Recule après ton obus au lieu de rester exposé."
  },
  {
    cle:"survie", nom:"Survie", ech:"batailles",
    calc:rs=>{ const l=rs.filter(r=>r.life>0); return l.length>=8
      ? {v:l.reduce((a,r)=>a+r.life,0)/l.length, n:l.length, u:"s"} : null; },
    mieux:"haut",
    constat:(m,c)=>"Tu tiens "+Math.round(m)+" s en moyenne, le clan "+Math.round(c)+" s.",
    action:"Tu pars trop tôt au contact. Laisse le premier échange à un char mieux blindé et arrive en second."
  },
  {
    cle:"apport", nom:"Apport hors dégâts", ech:"batailles",
    /* repérage et assistance, ramenés aux dégâts : distingue le joueur qui
       ne joue QUE le tir de celui qui fait jouer les autres */
    calc:rs=>{ const d=rs.reduce((a,r)=>a+(r.dmg||0),0);
      const a2=rs.reduce((a,r)=>a+(r.assist||0)+(r.spot||0)*300,0);
      return d>=15000 ? {v:a2/d, n:rs.length, u:"%"} : null; },
    mieux:"haut",
    constat:(m,c)=>"Pour 100 de dégâts tu apportes "+Math.round(m*100)+" d'assistance, le clan "+Math.round(c*100)+".",
    action:"Éclaire avant de tirer : un char repéré que trois alliés arrosent rapporte plus que ton seul obus."
  },
];
function pctf(x){ return Math.round(x*100)+" %"; }

/* La leçon, repliée par défaut : on ne noie pas celui qui veut juste
   son diagnostic. <details> se replie sans une ligne de JavaScript et
   reste accessible au clavier et aux lecteurs d'écran. */
function ficheHTML(cle){
  const f=COACH_FICHES[cle]; if(!f) return "";
  return '<details class="cc-f"><summary><span class="cc-fi">?</span>Comprendre ce geste</summary>'+
    '<div class="cc-fb">'+
      '<p><b>Ce que c\'est.</b> '+esc(f.quoi)+'</p>'+
      '<p><b>Pourquoi ça compte en Bastion.</b> '+esc(f.pourquoi)+'</p>'+
      '<p><b>Comment on le travaille.</b></p><ul>'+
        f.comment.map(c=>'<li>'+esc(c)+'</li>').join("")+'</ul>'+
      '<p class="cc-fr"><b>Le repère.</b> '+esc(f.repere)+'</p>'+
    '</div></details>';
}


/* Renvoie les écarts significatifs, du plus important au moins important. */

/* ── La courbe d'un geste ───────────────────────────────────────────
   Une valeur par bataille serait du bruit : sur dix obus, un rebond
   déplace le taux de dix points. On calcule donc sur une fenêtre
   glissante — c'est la tendance qui se travaille, pas la partie. */
function gesteCourbe(g, rs, k){
  const tri = rs.filter(r=>r.ts).slice().sort((a,b)=>a.ts-b.ts);
  if(tri.length < k) return [];
  const out=[];
  for(let i=k-1;i<tri.length;i++){
    const v=g.calc(tri.slice(i-k+1,i+1));
    if(v) out.push({ts:tri[i].ts, v:v.v});
  }
  return out;
}

/* ── Ce qu'un geste vaut, mesuré sur le clan ────────────────────────
   « 73 % au lieu de 77 % » : et alors ? On répond en regardant les
   joueurs du clan — ceux qui font ce geste le mieux font-ils plus de
   dégâts, et combien ?

   ⚠️ Seulement pour les gestes dont la formule NE CONTIENT PAS les
   dégâts. « Échange » vaut dégâts ÷ PV perdus, « Apport » vaut
   assistance ÷ dégâts : les relier aux dégâts revient à comparer une
   grandeur à elle-même. Mesuré sur le banc, ça donnait « progresser en
   apport te coûte 827 dégâts » — faux, et décourageant. */
const GESTE_VALEUR_OK = {precis:1, perce:1, blindage:1, survie:1};

function gesteValeur(g, clanRows){
  if(!GESTE_VALEUR_OK[g.cle]) return null;
  const parJoueur=new Map();
  for(const r of clanRows){
    if(!parJoueur.has(r.accId)) parJoueur.set(r.accId, []);
    parJoueur.get(r.accId).push(r);
  }
  const pts=[];
  for(const [id,l] of parJoueur){
    if(l.length<8) continue;                       // sous huit parties, c'est du hasard
    const v=g.calc(l); if(!v) continue;
    pts.push({g:v.v, dmg:l.reduce((a,r)=>a+(r.dmg||0),0)/l.length});
  }
  if(pts.length<12) return null;                   // trop peu de joueurs pour conclure
  pts.sort((a,b)=>a.g-b.g);
  const t=Math.max(3,Math.floor(pts.length/3));
  const bas=pts.slice(0,t), haut=pts.slice(-t);
  const moy=(l,c)=>l.reduce((a,x)=>a+x[c],0)/l.length;
  /* la corrélation dit si le lien est réel ou une coïncidence */
  const mg=moy(pts,"g"), md=moy(pts,"dmg");
  let sgd=0,sgg=0,sdd=0;
  for(const p of pts){ const a=p.g-mg, b=p.dmg-md; sgd+=a*b; sgg+=a*a; sdd+=b*b; }
  const cor=(sgg&&sdd)?sgd/Math.sqrt(sgg*sdd):0;
  const ecart=moy(haut,"dmg")-moy(bas,"dmg");
  /* on se tait plutôt que d'affirmer un lien qu'on ne voit pas */
  if(cor<0.3 || ecart<80) return null;
  return {n:pts.length, gBas:moy(bas,"g"), gHaut:moy(haut,"g"),
          dBas:moy(bas,"dmg"), dHaut:moy(haut,"dmg"), ecart, cor};
}

/* ── La courbe, dessinée ────────────────────────────────────────────
   Le repère du clan en pointillé : sans lui, une courbe qui monte ne
   dit pas si elle a rattrapé quoi que ce soit. */
function gesteSpark(pts, ref, u){
  if(pts.length<3) return "";
  const W=520, H=96, P=8;
  const vs=pts.map(p=>p.v).concat([ref]);
  let lo=Math.min(...vs), hi=Math.max(...vs);
  const marge=(hi-lo)*0.18 || (hi*0.06)||1; lo-=marge; hi+=marge;
  const x=i=>P+i*(W-2*P)/(pts.length-1);
  const y=v=>H-P-((v-lo)/(hi-lo))*(H-2*P);
  const d=pts.map((p,i)=>(i?"L":"M")+x(i).toFixed(1)+" "+y(p.v).toFixed(1)).join(" ");
  const aire=d+" L"+x(pts.length-1).toFixed(1)+" "+(H-P)+" L"+x(0).toFixed(1)+" "+(H-P)+" Z";
  const dernier=pts[pts.length-1];
  return '<svg class="tv-spark" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" role="img" '+
    'aria-label="'+esc(t("Évolution de ce geste sur tes dernières batailles"))+'">'+
    '<path d="'+aire+'" fill="url(#tvg)"/>'+
    '<defs><linearGradient id="tvg" x1="0" y1="0" x2="0" y2="1">'+
      '<stop offset="0" stop-color="var(--accent)" stop-opacity=".22"/>'+
      '<stop offset="1" stop-color="var(--accent)" stop-opacity="0"/>'+
    '</linearGradient></defs>'+
    '<line x1="'+P+'" x2="'+(W-P)+'" y1="'+y(ref).toFixed(1)+'" y2="'+y(ref).toFixed(1)+'" '+
      'stroke="var(--muted)" stroke-width="1" stroke-dasharray="4 4" opacity=".7"/>'+
    '<path d="'+d+'" fill="none" stroke="var(--accent)" stroke-width="2" '+
      'stroke-linejoin="round" stroke-linecap="round"/>'+
    '<circle cx="'+x(pts.length-1).toFixed(1)+'" cy="'+y(dernier.v).toFixed(1)+'" r="3.5" fill="var(--accent)"/>'+
  '</svg>';
}

/* ── Ce que je travaille ────────────────────────────────────────────
   UN geste, en grand. Pas trois cartes côte à côte : on ne travaille
   pas trois choses à la fois, et en proposer trois, c'est n'en faire
   travailler aucune. Le suivant reste accessible, replié. */
function pTravail(mesRows, clanRows){
  if(!mesRows.length) return "";
  const d=coachDiag(mesRows, clanRows);
  if(!d.total)
    return '<section class="tv tv-vide"><p>'+
      t("Pas encore assez de batailles pour comparer quoi que ce soit. Les conseils apparaissent à partir d'une dizaine de parties.")+
      '</p></section>';

  /* rien à corriger : on le dit, et on montre le point d'appui */
  if(!d.retards.length){
    const f=d.forts[0];
    return '<section class="tv tv-ok">'+
      '<div class="tv-card">'+
        '<h3>'+t("Rien ne décroche")+'</h3>'+
        '<p class="tv-p">'+t("Tu es dans la moyenne du clan sur les six gestes mesurés. Le prochain gain viendra du jeu d'équipe plutôt que de la technique individuelle.")+'</p>'+
        (f?'<p class="tv-p tv-fort">'+t("Ton point d'appui")+' : <b>'+esc(f.nom)+'</b> — '+
            f.constat(f.m,f.c)+'</p>':"")+
      '</div></section>';
  }

  const g=d.retards[0], suivant=d.retards[1];
  const u=g.u;
  const val=v=>u==="%"?pctf(v):(u==="s"?Math.round(v)+" s":v.toFixed(2));
  const pct=Math.round(Math.abs(g.ecart)*100);

  /* la courbe de CE geste : la seule qui dise si le travail paie */
  const k=Math.max(5, Math.min(10, Math.round(mesRows.length/4)));
  const pts=gesteCourbe(g, mesRows, k);
  const spark=pts.length>=3
    ? '<div class="tv-evo">'+
        '<div class="tv-evo-h">'+t("Ce geste, sur tes dernières batailles")+
          '<span class="hint">'+t("moyenne glissante sur {n} batailles").replace("{n}",k)+' · '+
          t("pointillé = le clan")+'</span></div>'+
        gesteSpark(pts, g.c, u)+
      '</div>'
    : '<div class="tv-evo tv-evo-non">'+t("La courbe de ce geste apparaîtra vers la vingtième bataille — en dessous, elle bougerait au hasard.")+'</div>';

  /* ce que ça vaut, quand le clan permet de le mesurer */
  const va=gesteValeur(g, clanRows);
  const vaut=va
    ? '<div class="tv-vaut">'+
        '<div class="tv-vaut-h">'+t("Ce que ça vaut")+'</div>'+
        '<p>'+t("Dans ton clan, les joueurs qui réussissent le mieux ce geste ({a}) font <b>{d1}</b> de dégâts par bataille, contre <b>{d2}</b> pour les autres ({b}).")
              .replace("{a}", val(va.gHaut)).replace("{b}", val(va.gBas))
              .replace("{d1}", fmt(Math.round(va.dHaut))).replace("{d2}", fmt(Math.round(va.dBas)))+
        ' <b class="tv-gain">'+t("Soit {n} de dégâts par bataille.").replace("{n}","+"+fmt(Math.round(va.ecart)))+'</b></p>'+
        '<footer>'+t("mesuré sur {n} joueurs du clan").replace("{n}",va.n)+'</footer>'+
      '</div>'
    : "";

  const pos=Math.max(-50,Math.min(50,g.ecart*100));

  /* Plus d'en-tête ici : la station 02 du fil l'annonce déjà. */
  return '<section class="tv">'+
    '<article class="tv-card">'+
      '<header class="tv-top">'+
        '<div><h3>'+esc(g.nom)+'</h3>'+
          '<p class="tv-constat">'+g.constat(g.m,g.c)+'</p></div>'+
        '<div class="tv-chiffres">'+
          /* L'anneau plutôt que le chiffre seul : la part remplie se voit
           avant d'être lue, et le trait doré du repère dit d'un coup
           d'œil si l'on est au-dessus ou en dessous du clan. */
        (u==="%"
          ? anneauHTML(g.m, val(g.m), t("toi"), g.ecart>=0?"var(--good)":"var(--accent)")
          : '<div class="tv-moi"><b>'+val(g.m)+'</b><span>'+t("toi")+'</span></div>')+
          '<div class="tv-ecart">'+(g.ecart>=0?"+":"−")+pct+' %</div>'+
          '<div class="tv-clan"><b>'+val(g.c)+'</b><span>'+t("le clan")+'</span></div>'+
        '</div>'+
      '</header>'+
      '<div class="tv-jauge"><span class="tv-ref"></span><i style="'+
        (pos>=0?"left:50%;width:"+pos+"%":"right:50%;width:"+(-pos)+"%")+'"></i></div>'+
      spark+
      vaut+
      '<p class="tv-action"><span>→</span>'+esc(g.action)+'</p>'+
      ficheHTML(g.cle)+
      '<footer class="tv-f">'+t("mesuré sur")+' '+fmt(g.n)+' '+esc(t(g.ech||"batailles"))+'</footer>'+
    '</article>'+
    (suivant
      ? '<details class="tv-next"><summary>'+t("Le geste suivant")+' : <b>'+esc(suivant.nom)+'</b> '+
          '<span class="tv-next-e">'+(suivant.ecart>=0?"+":"−")+Math.round(Math.abs(suivant.ecart)*100)+' %</span></summary>'+
          '<p class="tv-p">'+suivant.constat(suivant.m,suivant.c)+'</p>'+
          '<p class="tv-action"><span>→</span>'+esc(suivant.action)+'</p>'+
        '</details>'
      : "")+
  '</section>';
}


/* ── L'anneau de progression ────────────────────────────────────────
   Un pourcentage ne se voit pas ; un arc, si. L'anneau montre où l'on
   se situe entre son point de départ et le repère du clan — la part
   parcourue, pas la valeur brute, parce que c'est le chemin qui se
   travaille.

   Deux arcs superposés : la piste (ce qu'il reste) et l'arc doré (ce
   qui est fait). Le trait est fin : la DA du site ne crie pas. */
function anneauHTML(part, gros, petit, teinte){
  const R=34, C=2*Math.PI*R;
  const p=Math.max(0,Math.min(1,part||0));
  const col=teinte||"var(--accent)";
  return '<div class="an">'+
    '<svg viewBox="0 0 80 80" aria-hidden="true">'+
      '<circle cx="40" cy="40" r="'+R+'" fill="none" stroke="var(--grid)" stroke-width="6"/>'+
      '<circle cx="40" cy="40" r="'+R+'" fill="none" stroke="'+col+'" stroke-width="6" '+
        'stroke-linecap="round" stroke-dasharray="'+C.toFixed(1)+'" '+
        'stroke-dashoffset="'+(C*(1-p)).toFixed(1)+'" transform="rotate(-90 40 40)"/>'+
    '</svg>'+
    '<div class="an-c"><b>'+gros+'</b>'+(petit?'<span>'+petit+'</span>':"")+'</div>'+
  '</div>';
}

/* ── Le terrain ─────────────────────────────────────────────────────
   La carte où l'on perd le plus, en image. Un nom de carte écrit ne
   dit rien à l'œil ; sa vue du dessus, si — c'est celle que le joueur
   a devant lui pendant la partie.

   On ne montre une carte que si elle a assez de batailles pour vouloir
   dire quelque chose : sur deux parties, 0 % de victoire est du
   hasard, pas un enseignement. */
function pTerrain(my, clanRows){
  if(!my.length) return "";
  const parCarte=new Map();
  for(const b of my){
    if(!b.mapName) continue;
    const k=mapKey(b.mapName);
    if(!k) continue;
    if(!parCarte.has(k)) parCarte.set(k, {k, nom:b.mapName, n:0, v:0, dmg:0});
    const c=parCarte.get(k);
    c.n++; if(b.result===1) c.v++; c.dmg+=(b.dmg||0);
  }
  const MIN=4;                                   // sous quatre parties, on se tait
  const cartes=[...parCarte.values()].filter(c=>c.n>=MIN);
  if(!cartes.length){
    return '<div class="tr-vide">'+
      t("Pas encore assez de batailles sur une même carte pour en tirer quelque chose. Il en faut au moins {n} sur la même — en dessous, un mauvais soir suffit à tout fausser.").replace("{n}",MIN)+
      '</div>';
  }
  cartes.sort((a,b)=>(a.v/a.n)-(b.v/b.n));
  const dure=cartes[0], facile=cartes[cartes.length-1];
  const moyGlobale=my.reduce((a,b)=>a+(b.dmg||0),0)/my.length;

  const vignette=(c,role)=>{
    const wr=c.v/c.n, dmg=c.dmg/c.n;
    const ecart=moyGlobale? (dmg-moyGlobale)/moyGlobale : 0;
    return '<article class="tr-c tr-'+role+'">'+
      '<div class="tr-img">'+
        '<img src="maps/top/'+esc(c.k)+'.jpg" alt="'+esc(t("Vue du dessus de {s}").replace("{s}", prettyMap(c.nom)))+'" '+
          'loading="lazy" onerror="this.closest(\'.tr-img\').classList.add(\'tr-noimg\')">'+
        '<span class="tr-tag">'+(role==="dure"?t("la plus difficile"):t("la plus favorable"))+'</span>'+
      '</div>'+
      '<div class="tr-b">'+
        '<h4>'+esc(prettyMap(c.nom))+'</h4>'+
        '<div class="tr-k">'+
          '<span><b class="'+(wr>=0.5?"tagpos":"tagneg")+'">'+Math.round(wr*100)+' %</b>'+t("de victoires")+'</span>'+
          '<span><b>'+fmt(Math.round(dmg))+'</b>'+t("dégâts moyens")+'</span>'+
          '<span><b>'+c.n+'</b>'+t("batailles")+'</span>'+
        '</div>'+
        '<p class="tr-p">'+(role==="dure"
          ? (ecart<-0.12
             ? t("Tes dégâts y tombent de {n} % sous ta moyenne. C'est la carte à revoir en débriefing — le replay d'une défaite y apprendra plus qu'ailleurs.").replace("{n}",Math.round(-ecart*100))
             : t("Tu y fais tes dégâts habituels mais tu la perds quand même : le problème est dans le placement ou le tempo, pas dans le tir."))
          : t("C'est là que tu joues le mieux. Regarde ce que tu y fais différemment — c'est souvent transposable ailleurs."))+'</p>'+
      '</div>'+
    '</article>';
  };

  return '<div class="tr">'+vignette(dure,"dure")+
    (facile!==dure? vignette(facile,"facile") : "")+'</div>';
}


/* ═══════════════════════════════════════════════════════════════════
   LE PONT — cinq étapes qui défilent horizontalement
   ═══════════════════════════════════════════════════════════════════ */

/* ── Les figures ────────────────────────────────────────────────────
   Chacune dit une chose que le texte dirait moins bien, et aucune ne
   ressemble aux autres. */

/* La bande des dernières batailles : le rythme, vu d'un coup. Une
   alternance de vert et de rouge se lit avant d'être comptée. */
function dkBandes(my){
  const dix=my.slice().sort((x,y)=>y.ts-x.ts).slice(0,12).reverse()
    .filter(r=>r.result===1||r.result===0);
  if(dix.length<4) return "";
  /* La hauteur dit les degats de la bataille, la couleur dit le
     resultat. Deux barres pleines ou a 40 % ne disaient que le second,
     et donnaient a une suite de resultats l'allure d'un code-barres.
     Le plancher a 18 % evite qu'une bataille ratee disparaisse. */
  const mx=Math.max(...dix.map(b=>b.dmg||0), 1);
  return '<div class="dkf dkf-b">'+dix.map((b,i)=>{
    const h=Math.round(18+((b.dmg||0)/mx)*82);
    return '<i class="'+(b.result===1?"v":"d")+'" style="--i:'+i+';height:'+h+'%" '+
      'title="'+fmt(Math.round(b.dmg||0))+'"></i>';
  }).join("")+'</div>';
}

/* L'anneau : la part remplie se voit avant d'être lue. Le trait doré en
   travers est le repère du clan — c'est lui qui dit si l'on est
   au-dessus ou en dessous, sans avoir à comparer deux nombres. */
function dkAnneau(part, repere, gros, petit, ton){
  const R=68, C=2*Math.PI*R, p=Math.max(0,Math.min(1,part||0));
  const ang=(Math.max(0,Math.min(1,repere==null?0:repere))*360)-90;
  const rad=ang*Math.PI/180;
  const x1=90+Math.cos(rad)*(R-11), y1=90+Math.sin(rad)*(R-11);
  const x2=90+Math.cos(rad)*(R+11), y2=90+Math.sin(rad)*(R+11);
  return '<div class="dkf dkf-a">'+
    '<svg viewBox="0 0 180 180" aria-hidden="true">'+
      '<circle cx="90" cy="90" r="'+R+'" fill="none" stroke="var(--grid)" stroke-width="9"/>'+
      /* --c et --do portent la longueur du cercle et l'arrivée : c'est
         ce qui permet à l'animation CSS de partir du vide sans que le
         JavaScript ait à mesurer quoi que ce soit. */
      '<circle class="dka-arc" cx="90" cy="90" r="'+R+'" fill="none" '+
        'style="--c:'+C.toFixed(1)+';--do:'+(C*(1-p)).toFixed(1)+'" '+
        'stroke="'+(ton==="dn"?"var(--bad)":"var(--good)")+'" stroke-width="9" stroke-linecap="round" '+
        'stroke-dasharray="'+C.toFixed(1)+'" stroke-dashoffset="'+(C*(1-p)).toFixed(1)+'" '+
        'transform="rotate(-90 90 90)"/>'+
      (repere!=null?'<line x1="'+x1.toFixed(1)+'" y1="'+y1.toFixed(1)+'" x2="'+x2.toFixed(1)+
        '" y2="'+y2.toFixed(1)+'" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round"/>':"")+
    '</svg>'+
    '<div class="dka-c"><b>'+gros+'</b><span>'+petit+'</span></div>'+
  '</div>';
}

/* La carte, cadrée. Pas un fond : un objet qu'on regarde. */
function dkCarte(k, nom, tag){
  if(!k) return "";
  return '<div class="dkf dkf-m">'+
    '<img src="maps/top/'+esc(k)+'.jpg" alt="'+esc(nom)+'" loading="lazy" '+
      'onerror="this.closest(\'.dkf-m\').remove()">'+
    (tag?'<span class="dkm-t">'+tag+'</span>':"")+
  '</div>';
}

/* La courbe : une progression se voit, elle ne se raconte pas. */
function dkCourbe(pts){
  if(!pts || pts.length<4) return "";
  const W=300, H=120, mn=Math.min(...pts), mx=Math.max(...pts);
  const et=(mx-mn)||1;
  const X=i=>(i/(pts.length-1))*W;
  const Y=v=>H-8-((v-mn)/et)*(H-20);
  const d=pts.map((v,i)=>(i?"L":"M")+X(i).toFixed(1)+" "+Y(v).toFixed(1)).join(" ");
  return '<div class="dkf dkf-c">'+
    '<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" aria-hidden="true">'+
      '<path d="'+d+' L'+W+' '+H+' L0 '+H+' Z" fill="url(#dkgrad)" opacity=".5"/>'+
      '<path class="dkc-l" d="'+d+'" fill="none" stroke="var(--accent)" stroke-width="2.5" '+
        'stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>'+
      '<defs><linearGradient id="dkgrad" x1="0" y1="0" x2="0" y2="1">'+
        '<stop offset="0" stop-color="var(--accent)" stop-opacity=".38"/>'+
        '<stop offset="1" stop-color="var(--accent)" stop-opacity="0"/>'+
      '</linearGradient></defs>'+
    '</svg>'+
  '</div>';
}

/* La jauge des paliers : un SR seul ne dit rien. Placé sur l'échelle,
   il dit d'un coup d'œil où l'on est et ce qui vient après. */
const DK_PALIERS=[[1000,"var(--bad)"],[1350,"var(--accent)"],[1650,"var(--ink-2)"],
                  [2000,"#4f97ee"],[2500,"var(--good)"]];
function dkJauge(sr){
  if(sr==null) return "";
  const MIN=800, MAX=2800, pos=v=>Math.max(0,Math.min(100,(v-MIN)/(MAX-MIN)*100));
  const seg=DK_PALIERS.map((p,i)=>{
    const d=pos(p[0]), f=i+1<DK_PALIERS.length?pos(DK_PALIERS[i+1][0]):100;
    return '<s style="--k:'+i+';left:'+d.toFixed(1)+'%;width:'+(f-d).toFixed(1)+'%;background:'+p[1]+'"></s>';
  }).join("");
  return '<div class="dkf dkf-j">'+
    '<div class="dkj-b">'+seg+
      '<div class="dkj-m" style="left:'+pos(sr).toFixed(1)+'%"></div></div>'+
    '<div class="dkj-l">'+DK_PALIERS.map(p=>
      '<span style="left:'+pos(p[0]).toFixed(1)+'%">'+fmt(p[0])+'</span>').join("")+'</div>'+
  '</div>';
}


/* ── Le rang dans le clan ───────────────────────────────────────────
   « 1 557 de SR » ne dit rien à qui ne connaît pas l'échelle ; « 12ᵉ sur
   47 » se comprend sans explication.
   On n'y fait figurer que les joueurs ayant assez de batailles : classer
   quelqu'un sur trois parties le place au hasard, et fausse le rang de
   tous les autres au passage. */
function dkRang(clanRows, moi){
  const par=new Map();
  for(const r of clanRows){
    if(r.accId==null) continue;
    if(!par.has(r.accId)) par.set(r.accId,[]);
    par.get(r.accId).push(r);
  }
  const l=[];
  for(const [id,rs] of par){
    if(rs.length<8) continue;
    const v=srAvg(rs);
    if(v!=null) l.push({id, sr:v});
  }
  if(l.length<5) return null;
  l.sort((a,b)=>b.sr-a.sr);
  const i=l.findIndex(x=>Number(x.id)===Number(moi));
  return i<0 ? null : {rang:i+1, total:l.length};
}

/* ── L'étendue dans le temps ────────────────────────────────────────
   Vingt-cinq batailles en une semaine et vingt-cinq en six mois ne
   racontent pas la même chose. Le nombre seul cache cette différence. */
function dkEtendue(my){
  const t=my.map(r=>r.ts).filter(Boolean);
  if(t.length<2) return null;
  const j=Math.round((Math.max(...t)-Math.min(...t))/86400);
  return j<2 ? null : j;
}

/* ── La marche suivante ─────────────────────────────────────────────
   Un classement se contemple ; un objectif chiffré se vise. */
function dkProchain(sr){
  if(sr==null) return null;
  const p=DK_PALIERS.map(x=>x[0]).filter(v=>v>sr).sort((a,b)=>a-b)[0];
  return p==null ? null : {cible:p, reste:Math.round(p-sr), nom:ceTier(p).l};
}

/* ── L'écart de dégâts sur une carte ────────────────────────────────
   Perdre sur une carte est un fait. Y faire moins de dégâts qu'ailleurs
   dit POURQUOI, et oriente vers le placement plutôt que vers le tir. */
function dkEcartCarte(c, my){
  if(!c || !my.length) return null;
  const moy=my.reduce((a,r)=>a+(r.dmg||0),0)/my.length;
  if(!moy) return null;
  return Math.round(((c.dmg/c.n)/moy-1)*100);
}


/* ── ⑤ Les instruments ──────────────────────────────────────────────
   Dessinés plutôt qu'empruntés : nets à n'importe quelle taille, quelques
   centaines d'octets, et ce sont des objets du sujet — un réticule et une
   échelle télémétrique, pas un motif décoratif pris ailleurs.

   Ils sont posés à DROITE : la moitié gauche appartient au texte, et un
   réticule derrière un titre ne fait que le salir. */
function dkInstruments(){
  const L=[];
  /* le réticule : trois cercles et une croix graduée */
  L.push('<g transform="translate(760 300)">');
  [150,238,300].forEach((r,i)=>L.push('<circle r="'+r+'" fill="none" stroke="#d8b566" '+
    'stroke-opacity="'+(0.3-i*0.07).toFixed(2)+'" stroke-width="'+(1.6-i*0.35).toFixed(2)+'"/>'));
  L.push('<path d="M-330 0h150M180 0h150M0 -330v150M0 180v150" stroke="#d8b566" '+
    'stroke-opacity=".26" stroke-width="1.4"/>');
  /* les graduations du réticule : longues tous les cinq crans */
  for(let i=-9;i<=9;i++){ if(!i) continue;
    const x=i*16, h=(i%5===0)?13:6;
    L.push('<path d="M'+x+' '+(-h)+'V'+h+'" stroke="#d8b566" stroke-opacity=".3" stroke-width="1.2"/>');
  }
  L.push('</g>');
  /* l'échelle télémétrique, en pied de cadre */
  L.push('<g transform="translate(430 560)">');
  L.push('<path d="M0 0h660" stroke="#d8b566" stroke-opacity=".22" stroke-width="1.2"/>');
  for(let i=0;i<=22;i++){ const x=i*30, h=(i%5===0)?16:7;
    L.push('<path d="M'+x+' 0V'+(-h)+'" stroke="#d8b566" stroke-opacity="'+((i%5===0)?".3":".18")+'" stroke-width="1.2"/>');
  }
  L.push('</g>');
  /* les équerres de cadrage */
  const eq=(x,y,sx,sy)=>'<path d="M'+(x+40*sx)+' '+y+'H'+x+'V'+(y+40*sy)+'" fill="none" '+
    'stroke="#d8b566" stroke-opacity=".28" stroke-width="1.6"/>';
  L.push(eq(60,60,1,1)+eq(1140,60,-1,1)+eq(60,640,1,-1)+eq(1140,640,-1,-1));
  /* « meet » et non « slice » : ce dessin doit etre VU en entier, pas
     couvrir le cadre. Avec slice, sur un bandeau large, le reticule
     sortait de l'ecran par le haut et par le bas. */
  return '<svg viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid meet" aria-hidden="true">'+
    L.join("")+'</svg>';
}

/* ── ③ L'emblème du clan ────────────────────────────────────────────
   Wargaming le fournit en plusieurs tailles. On prend la plus grande
   disponible : à 6 % d'opacité et 500 px de large, la différence entre
   256 et 64 se voit encore. */
function dkEmbleme(){
  try{
    const e=(CLANINFO&&CLANINFO.emblems)||null;
    if(!e) return "";
    for(const t of ["x256","x195","x128","x64","x32"]){
      const v=e[t]; if(!v) continue;
      const u=v.wot||v.portal; if(u) return u;
    }
  }catch(_){}
  return "";
}

/* ── ④ Le char le plus joué ─────────────────────────────────────────
   La référence des véhicules arrive de la fonction serveur, en arrière-
   plan et sans bloquer. Tant qu'elle n'est pas là, le calque n'existe
   pas — le bandeau tient sans lui. */
function dkChar(my){
  try{
    if(!LO_REF || !(LO_REF.tanks||[]).length) return "";
    const n={};
    for(const r of my){ if(r.veh!=null) n[r.veh]=(n[r.veh]||0)+1; }
    const ids=Object.keys(n).sort((a,b)=>n[b]-n[a]);
    if(!ids.length) return "";
    const par={}; (LO_REF.tanks||[]).forEach(x=>par[x.tank_id]=x);
    for(const id of ids){
      const t=par[id] || par[Number(id)];
      if(t && t.icon) return t.icon;
    }
  }catch(_){}
  return "";
}


/* ── Les sommes brutes d'un paquet de lignes ─────────────────────
   On somme AVANT de diviser : une moyenne de ratios n'est pas le ratio
   des moyennes, et sur des batailles de longueurs différentes l'écart
   n'est pas négligeable. */
const DK_COLS=["shots","hits","pierce","dmg","pot","block","assist",
               "aradio","atrack","astun","hitsr","piercer"];
function dkSommes(rows){
  const S={n:rows.length};
  DK_COLS.forEach(k=>S[k]=0);
  for(const r of rows) for(const k of DK_COLS) S[k]+=r[k]||0;
  return S;
}

/* ── Les trois axes, et ce qui les compose ───────────────────────────
   Chaque étage sait se calculer à partir des sommes. Le mode dit comment
   se calcule le gain : produit ou composante additive. */
const DK_AXES=[
  { cle:"inflige", nom:"Dégâts infligés", avec:"les dégâts que tu infliges",
    sous:"ce que tu retires à l'adversaire",
    total:S=>S.n?S.dmg/S.n:null, mode:"produit",
    manque:"Tu infliges moins que les autres.",
    etages:[
      { cle:"obus", nom:"Obus tirés", sous:"par bataille", unite:"n",
        val:S=>S.n?S.shots/S.n:null,
        quand:"Tu ne tires pas assez : exposition, placement, ou tu meurs trop tôt.",
        quoi:"Cherche des angles où tu peux tirer plus longtemps, et vérifie ta durée de vie." },
      { cle:"touche", nom:"Obus qui touchent", sous:"sur les obus tirés", unite:"%",
        val:S=>S.shots?S.hits/S.shots:null,
        quand:"Ta visée décroche : tu tires en roulant, ou de trop loin.",
        quoi:"Attends l'arrêt complet du réticule sur les tirs longs, et rapproche-toi." },
      { cle:"perce", nom:"Obus qui percent", sous:"sur les obus qui touchent", unite:"%",
        val:S=>S.hits?S.pierce/S.hits:null,
        quand:"Ce n'est pas ta visée, c'est ton choix de cible.",
        quoi:"Vise les flancs, les toits de tourelle et les points faibles plutôt que la masse." },
      { cle:"parObus", nom:"Dégâts par perforation", sous:"quand un obus passe", unite:"n",
        val:S=>S.pierce?S.dmg/S.pierce:null,
        quand:"Tes coups portent peu : canon, munition, ou tu tapes trop haut en tier.",
        quoi:"Regarde ta configuration, et choisis des cibles à ta portée." },
    ]},
  { cle:"evite", nom:"Dégâts évités", avec:"les dégâts que tu évites",
    sous:"ce que ton blindage absorbe",
    total:S=>S.n?S.block/S.n:null, mode:"produit",
    manque:"Ton blindage travaille moins.",
    etages:[
      { cle:"feu", nom:"Feu encaissé", sous:"dégâts potentiels par bataille", unite:"n",
        val:S=>S.n?S.pot/S.n:null,
        quand:"Tu attires peu de feu : un blindage ne sert à personne s'il ne tient pas la ligne.",
        quoi:"Prends la première ligne quand ton blindage le permet — c'est du feu que tes alliés ne prennent pas." },
      { cle:"bloque", nom:"Part bloquée", sous:"sur le feu encaissé", unite:"%",
        val:S=>S.pot?S.block/S.pot:null,
        quand:"Ton blindage encaisse au lieu de renvoyer : c'est une question d'angle.",
        quoi:"Présente ton flanc en biais plutôt que de face, et cache tes points faibles." },
    ]},
  { cle:"permis", nom:"Dégâts permis", avec:"les dégâts que tu permets",
    sous:"ce que tes alliés infligent grâce à toi",
    total:S=>S.n?S.assist/S.n:null, mode:"composantes",
    manque:"Tes alliés profitent peu de toi.",
    etages:[
      { cle:"radio", nom:"Repérage", sous:"dégâts sur les cibles que tu éclaires", unite:"n",
        val:S=>S.n?S.aradio/S.n:null,
        quand:"Tu éclaires peu : tes alliés tirent sur ce qu'ils voient eux-mêmes.",
        quoi:"Avance ta vue là où l'équipe regarde, et reste en vie pour la tenir." },
      { cle:"chenilles", nom:"Immobilisation", sous:"dégâts sur les cibles que tu chenilles", unite:"n",
        val:S=>S.n?S.atrack/S.n:null,
        quand:"Tu immobilises peu : une cible arrêtée est une cible que toute l'équipe touche.",
        quoi:"Vise les chenilles quand tu ne peux pas percer le blindage." },
      { cle:"stun", nom:"Étourdissement", sous:"dégâts sur les cibles que tu étourdis", unite:"n",
        val:S=>S.n?S.astun/S.n:null,
        quand:"Tes tirs d'artillerie étourdissent peu.",
        quoi:"Privilégie les obus explosifs à proximité des cibles plutôt que le coup direct." },
    ]},
];

/* ── Une référence pondérée par le mélange de classes du joueur ────
   Les dégâts d'un léger et d'un lourd ne se comparent pas. Mais filtrer
   sur la seule classe la plus jouée jetterait la moitié des batailles
   d'un joueur qui alterne. Chaque classe est donc comparée à elle-même,
   puis recombinée dans SES proportions à lui.

   Vingt lignes minimum par classe : en dessous, une moyenne ne veut rien
   dire et fausserait la recombinaison. Si moins de 60 % du mélange est
   couvert, on renonce — une référence bâtie sur un tiers des batailles
   comparerait deux choses différentes. */
function dkRefPond(rows, part){
  const parCls=new Map();
  for(const r of rows){
    if(!parCls.has(r.cls)) parCls.set(r.cls,[]);
    parCls.get(r.cls).push(r);
  }
  const acc=new Map(), pds=new Map();
  let couvert=0;
  for(const [cls,poids] of Object.entries(part)){
    const l=parCls.get(cls);
    if(!l || l.length<20) continue;
    const S=dkSommes(l);
    couvert+=poids;
    for(const ax of DK_AXES){
      const t=ax.total(S);
      if(t!=null){ acc.set(ax.cle,(acc.get(ax.cle)||0)+t*poids); pds.set(ax.cle,(pds.get(ax.cle)||0)+poids); }
      for(const e of ax.etages){
        const k=ax.cle+"."+e.cle, v=e.val(S);
        if(v!=null){ acc.set(k,(acc.get(k)||0)+v*poids); pds.set(k,(pds.get(k)||0)+poids); }
      }
    }
  }
  if(couvert<0.6) return null;
  const out={couvert, n:rows.length, get:(k)=>pds.get(k)?acc.get(k)/pds.get(k):null};
  return out;
}

/* ── L'analyse complète ──────────────────────────────────────────────
   Trois axes, chacun avec ses étages, chacun comparé au clan ET aux
   adversaires réellement affrontés. On vise le MEILLEUR des deux : tous
   deux sont atteints par de vrais joueurs, dans la même classe et les
   mêmes batailles — ce n'est donc pas un objectif théorique. */
function dkAnalyse(my, clanRows){
  if(!my.length) return null;
  const S=dkSommes(my);
  /* Trente obus et huit batailles : en dessous, un seul tir déplace un
     taux de plusieurs points. Le seuil est dit, pas subi. */
  if(S.n<8 || S.shots<30) return null;

  const part={};
  for(const r of my){ part[r.cls]=(part[r.cls]||0)+1/my.length; }

  const f=pfilter();
  const clan=dkRefPond(clanRows.filter(r=>r.accId!==SELP), part);
  const adv =dkRefPond((typeof RAW!=="undefined"?RAW:[]).filter(r=>!r.isMember && f(r)), part);
  if(!clan && !adv) return null;

  const mieux=(c,a)=>{
    if(c==null && a==null) return {ref:null,qui:null};
    if(a==null || (c!=null && c>=a)) return {ref:c,qui:"clan"};
    return {ref:a,qui:"adv"};
  };

  const axes=DK_AXES.map(ax=>{
    const moi=ax.total(S);
    const c=clan?clan.get(ax.cle):null, a=adv?adv.get(ax.cle):null;
    const {ref,qui}=mieux(c,a);
    /* La marge est RELATIVE : les trois axes n'ont pas les mêmes ordres
       de grandeur, et un écart de 200 ne pèse pas pareil sur 2 400 que
       sur 800. */
    const marge=(ref && moi!=null)?(ref-moi)/ref:null;
    const etages=ax.etages.map(e=>{
      const m=e.val(S);
      const ec=clan?clan.get(ax.cle+"."+e.cle):null, ea=adv?adv.get(ax.cle+"."+e.cle):null;
      const r2=mieux(ec,ea);
      /* Produit : amener cet étage à la référence multiplie le total par
         (réf/moi). Composante : le gain est l'écart, tout simplement —
         on ne suppose alors aucune identité. */
      let gain=0;
      if(r2.ref!=null && m!=null){
        gain = ax.mode==="produit"
          ? (m? moi*(r2.ref/m-1) : 0)
          : (r2.ref-m);
      }
      return {...e, axe:ax.cle, moi:m, clan:ec, adv:ea, ref:r2.ref, qui:r2.qui,
              gain:Math.max(0,gain), vide:(!m && !r2.ref)};
    }).filter(e=>!e.vide);   /* l'étourdissement n'existe pas hors artillerie */
    return {...ax, moi, clan:c, adv:a, ref, qui, marge, etages};
  });

  /* L'axe désigné est celui qui a la plus grande marge — même quand elle
     est négative. Ce n'est pas « où tu es mauvais » mais « où il te reste
     le plus à prendre », et c'est vrai dans les deux cas. */
  const avecMarge=axes.filter(a=>a.marge!=null);
  const faible=avecMarge.length
    ? avecMarge.slice().sort((x,y)=>y.marge-x.marge)[0] : null;
  const tousBons = faible ? faible.marge<0.02 : false;

  /* Dans l'axe désigné, l'étage qui fuit : celui dont le gain est le plus
     gros. Sous cinquante dégâts, l'écart ne vaut pas qu'on dérange. */
  let fuite=null;
  if(faible && faible.etages.length){
    const t=faible.etages.slice().sort((x,y)=>y.gain-x.gain)[0];
    if(t && t.gain>=50) fuite=t;
  }
  return {S, axes, faible, fuite, tousBons, mix:part};
}

/* ── La figure : des barres comparées à leur référence ───────────────
   Deux barres par ligne sur la MÊME échelle, et la référence en trait
   plutôt qu'en seconde barre : deux barres pleines superposées rendent
   le dépassement illisible. Le lecteur voit qui décroche sans calculer —
   c'est précisément ce qu'on lui reproche de ne pas faire. */
function dkBarres(lignes, marque, ton){
  if(!lignes || !lignes.length) return "";
  return '<div class="dkf dkf-e">'+lignes.map(e=>{
    const val=v=>v==null?"—":(e.unite==="%"?pctf(v):fmt(Math.round(v)));
    const m=e.moi||0, r=e.ref||0, max=Math.max(m,r)||1;
    /* Rouge quand ca fuit, or quand c est simplement la ou il reste le
       plus a prendre. Le rouge promet un probleme : le reserver. */
    const vif = marque && marque===e.cle;
    return '<div class="dke'+(vif?(ton==="vise"?" dke-vise":" dke-fuit"):"")+'">'+
      '<div class="dke-h"><span>'+t(e.nom)+'</span><b>'+val(e.moi)+'</b></div>'+
      '<div class="dke-b">'+
        '<i class="dke-moi" style="width:'+(m/max*100).toFixed(1)+'%"></i>'+
        (e.ref!=null?'<i class="dke-ref" style="left:'+(r/max*100).toFixed(1)+'%"></i>':"")+
      '</div>'+
      '<div class="dke-f">'+(e.ref!=null
        ? t("référence {n}").replace("{n}", val(e.ref))
        : t("pas de référence"))+'</div>'+
    '</div>';
  }).join("")+'</div>';
}

/* Les titres du bandeau 03 : une phrase par étage, parce que les
   problèmes qu'ils désignent n'ont rien à voir entre eux. */
const DK_FUITE_TITRE={
  obus:"Tu ne tires pas assez.", touche:"Tu tires trop souvent à côté.",
  perce:"Tes obus ne percent pas.", parObus:"Tes coups portent peu.",
  feu:"Tu ne prends pas assez de feu.", bloque:"Ton blindage ne renvoie pas.",
  radio:"Tu éclaires peu.", chenilles:"Tu immobilises peu.", stun:"Tu étourdis peu.",
};

/* ── Le détail des trois contributions ─────────────────────────────── */
function pContributions(my, clanRows){
  const A=dkAnalyse(my, clanRows);
  if(!A) return '<section class="card"><div class="empty">'+
    t("Il faut au moins trente obus tirés et huit batailles pour comparer tes contributions.")+'</div></section>';
  const lignes=A.axes.map(a=>{
    const vif=A.faible&&A.faible.cle===a.cle;
    return '<tr'+(vif?' class="ent-fuit"':"")+'>'+
      '<td><b>'+t(a.nom)+'</b><div class="hint">'+t(a.sous)+'</div></td>'+
      '<td class="num">'+fmt(Math.round(a.moi||0))+'</td>'+
      '<td class="num hint">'+(a.clan!=null?fmt(Math.round(a.clan)):"—")+'</td>'+
      '<td class="num hint">'+(a.adv!=null?fmt(Math.round(a.adv)):"—")+'</td>'+
      '<td class="num">'+(a.marge!=null
        ? '<b class="'+(a.marge>0?"tagneg":"tagpos")+'">'+(a.marge>0?"−":"+")+
          Math.round(Math.abs(a.marge)*100)+' %</b>' : '<span class="hint">—</span>')+'</td>'+
    '</tr>';
  }).join("");
  return '<section class="card">'+
    '<h2>'+t("Tes trois contributions")+' <span class="hint">'+
      t("moyenne par bataille, comparée à ta classe de char")+'</span></h2>'+
    '<div class="tw"><table class="mini"><thead><tr>'+
      '<th>'+t("Contribution")+'</th><th class="num">'+t("Toi")+'</th>'+
      '<th class="num">'+t("Clan")+'</th><th class="num">'+t("Adversaires")+'</th>'+
      '<th class="num">'+t("Marge")+'</th>'+
    '</tr></thead><tbody>'+lignes+'</tbody></table></div>'+
    '<footer class="hint">'+t("La marge est l'écart au meilleur des deux références, en pourcentage. C'est elle qui désigne la contribution à travailler — pas la valeur brute, qui ne se compare pas d'un axe à l'autre.")+'</footer>'+
  '</section>';
}

/* ── Le détail de la décomposition ─────────────────────────────────── */
function pEntonnoir(my, clanRows){
  const A=dkAnalyse(my, clanRows);
  if(!A || !A.faible) return '<section class="card"><div class="empty">'+
    t("Il faut au moins trente obus tirés et huit batailles pour décomposer tes contributions.")+'</div></section>';
  const ax=A.faible;
  const val=(e,v)=>v==null?"—":(e.unite==="%"?pctf(v):fmt(Math.round(v)));
  const lignes=ax.etages.map(e=>{
    const vif=A.fuite&&A.fuite.cle===e.cle;
    return '<tr'+(vif?' class="ent-fuit"':"")+'>'+
      '<td><b>'+t(e.nom)+'</b><div class="hint">'+t(e.sous)+'</div></td>'+
      '<td class="num">'+val(e,e.moi)+'</td>'+
      '<td class="num hint">'+val(e,e.clan)+'</td>'+
      '<td class="num hint">'+val(e,e.adv)+'</td>'+
      '<td class="num">'+(e.gain>=25?'<b class="tagpos">+'+fmt(Math.round(e.gain))+'</b>':'<span class="hint">—</span>')+'</td>'+
    '</tr>';
  }).join("");
  const form = ax.mode==="produit"
    ? t("Une identité exacte : le produit des étages redonne le total, sans reste.")
    : t("Des composantes, pas une somme : le total enregistré par le mod et le détail de ses trois postes ne se recoupent pas exactement. On ne suppose donc aucune identité — chaque poste est comparé pour lui-même.");
  return '<section class="card">'+
    '<h2>'+t("D'où viennent {s}").replace("{s}", t(ax.avec))+
      ' <span class="hint">'+t(ax.sous)+'</span></h2>'+
    '<div class="tw"><table class="mini"><thead><tr>'+
      '<th>'+t("Étage")+'</th><th class="num">'+t("Toi")+'</th>'+
      '<th class="num">'+t("Clan")+'</th><th class="num">'+t("Adversaires")+'</th>'+
      '<th class="num">'+t("Dégâts en jeu")+'</th>'+
    '</tr></thead><tbody>'+lignes+'</tbody></table></div>'+
    (A.fuite
      ? '<p class="ent-quoi"><b>'+t(A.fuite.quand)+'</b> '+t(A.fuite.quoi)+'</p>'
      : '<p class="ent-quoi">'+t("Aucun étage ne décroche assez pour valoir un changement.")+'</p>')+
    '<footer class="hint">'+form+' '+
      t("Références calculées sur ta classe de char, pondérées par les classes que tu joues.")+'</footer>'+
  '</section>';
}

/* ── Un panneau ─────────────────────────────────────────────────────
   Repère, titre, UNE ligne, deux chiffres, un bouton. Rien de plus :
   c'est la contrainte qui fait la lisibilité, pas le style. */
function dkPanneau(o){
  const st=(o.stats||[]).filter(Boolean).slice(0,3).map((f,i)=>
    '<li style="--j:'+i+'"><b'+(f.ton?' class="'+f.ton+'"':"")+' data-v="'+f.v+'">'+
      f.v+'</b><span>'+f.l+'</span></li>').join("");
  return ''+
    /* Quatre calques, quatre vitesses. Chacun se retire proprement s'il
       manque : pas de relief pour cette carte, pas d'emblème pour ce clan,
       pas encore de référence des chars. Un fond incomplet reste un fond. */
    '<div class="dk-bg" aria-hidden="true">'+
      (o.fond?'<div class="dk-map"><img src="relief/'+esc(o.fond)+'.svg" alt="" '+
        'loading="lazy" onerror="this.closest(\'.dk-map\').remove()"></div>':"")+
      /* onload autant qu'onerror : la référence ne garantit aucune
         résolution, et une icône de 64 px étirée sur 560 est le défaut
         même qu'on cherchait à corriger. Sous 240 px de large, le calque
         se retire. Trois calques nets valent mieux que quatre dont un
         flou. */
      (o.char?'<div class="dk-char"><img src="'+esc(o.char)+'" alt="" loading="lazy" '+
        'onerror="this.closest(\'.dk-char\').remove()" '+
        'onload="if(this.naturalWidth<240)this.closest(\'.dk-char\').remove()"></div>':"")+
      (o.emb?'<div class="dk-em"><img src="'+esc(o.emb)+'" alt="" loading="lazy" '+
        'onerror="this.closest(\'.dk-em\').remove()"></div>':"")+
      '<div class="dk-inst">'+dkInstruments()+'</div>'+
      '<div class="dk-veil"></div>'+
    '</div>'+
    '<div class="dk-c">'+
      '<div class="dk-w">'+
        '<p class="dk-eb"><span>0'+o.n+'</span>'+esc(o.etape)+'</p>'+
        '<h2 class="dk-t">'+o.titre+'</h2>'+
        (o.ligne?'<p class="dk-l">'+o.ligne+'</p>':"")+
        (st?'<ul class="dk-s">'+st+'</ul>':"")+
        '<button class="dk-more" type="button" data-e="'+o.n+'">'+
          t("Voir le détail")+'<svg viewBox="0 0 24 24" aria-hidden="true">'+
          '<path d="M12 5v14M5 12l7 7 7-7"/></svg></button>'+
      '</div>'+
      (o.fig?'<div class="dk-fig">'+o.fig+'</div>':"")+
    '</div>';
}

/* ── Ce que les cinq panneaux racontent ─────────────────────────────
   Tout vient des batailles du joueur. Quand une donnée manque, on le
   dit : « pas encore assez de batailles » est une information, un
   chiffre inventé n'en est pas une. */
function dkDonnees(my, clanRows){
  const now=Date.now()/1000;
  const bw=battlesWinrate(my);
  const d=coachDiag(my, clanRows);

  const W=(dj,dec)=>my.filter(r=>r.ts && (now-r.ts)>(dec?dj*86400:0) && (now-r.ts)<=(dec?2*dj*86400:dj*86400));
  const moy=rs=>rs.length? rs.reduce((x,r)=>x+(r.dmg||0),0)/rs.length : null;
  const dRec=moy(W(30,false)), dPre=moy(W(30,true));
  const dpts=(dRec!=null && dPre!=null && W(30,true).length>=5) ? Math.round((dRec/dPre-1)*100) : null;

  /* les cartes, seuil de quatre batailles — le même que le détail, pour
     que le panneau et le bloc du dessous ne se contredisent jamais */
  const pc=new Map();
  for(const r of my){ if(!r.mapName) continue; const k=mapKey(r.mapName); if(!k) continue;
    if(!pc.has(k)) pc.set(k,{k,nom:r.mapName,n:0,v:0,dmg:0});
    const c=pc.get(k); c.n++; if(r.result===1) c.v++; c.dmg+=(r.dmg||0); }
  const cartes=[...pc.values()].filter(c=>c.n>=4).sort((x,y)=>(x.v/x.n)-(y.v/y.n));
  const dure=cartes[0]||null;
  const pool=[...pc.values()].sort((x,y)=>y.n-x.n).filter(c=>!dure||c.k!==dure.k);
  const F=(i)=>(pool[i]||pool[0]||dure||null);

  const sr=srAvg(my), tier=ceTier(sr), tr=pSRTrend(my), st=pStreak(my);
  /* L'emblème et le char sont les mêmes pour les cinq panneaux : on les
     cherche une fois. */
  const emb=dkEmbleme(), chr=dkChar(my);
  const g=d.retards[0]||null;
  const vg=v=>g? (g.u==="%"?pctf(v):(g.u==="s"?Math.round(v)+" s":v.toFixed(2))) : "—";
  /* Ce que ce geste vaut en DÉGÂTS, mesuré sur les joueurs du clan.
     Renvoie null quand la corrélation est trop faible ou l'échantillon
     trop mince : mieux vaut se taire qu'affirmer au hasard. */
  const va = g ? gesteValeur(g, clanRows) : null;
  const rang = dkRang(clanRows, SELP);
  const jours = dkEtendue(my);

  /* ── 01 ── le rythme */
  let t1;
  if(dpts!=null && dpts>=8)       t1=t("Tu montes.");
  else if(dpts!=null && dpts<=-8) t1=t("Tu redescends.");
  else if(bw.wr>=0.55)            t1=t("Tu tiens ton niveau.");
  else                            t1=t("Tu cherches ton rythme.");
  const h1={ n:1, etape:t("Où tu en es"), titre:t1,
    ligne: jours
      ? t("{n} batailles sur {j} jours.").replace("{n}",fmt(bw.battles)).replace("{j}",fmt(jours))
      : t("{n} batailles analysées.").replace("{n}",fmt(bw.battles)),
    fond:(F(0)||{}).k, fig:dkBandes(my),
    /* Le rang situe mieux que le taux : « 52 % » ne se compare à rien,
       « 12ᵉ sur 47 » se comprend d'un coup. */
    stats:[
      {v:Math.round(bw.wr*100)+" %", l:t("de victoires"), ton:bw.wr>=0.5?"up":"dn"},
      rang?{v:rang.rang+"<i>/"+rang.total+"</i>", l:t("dans le clan"),
            ton:rang.rang<=Math.ceil(rang.total/3)?"up":""}:null,
      dpts!=null?{v:(dpts>=0?"+":"−")+Math.abs(dpts)+" %", l:t("dégâts sur 30 j"), ton:dpts>=0?"up":"dn"}:null,
    ]};

  /* ── 02 ── le geste */
  /* ── 02 ── LES TROIS CONTRIBUTIONS ───────────────────────────────
     Tout ce que le joueur fait se range en trois. On désigne celle qui a
     la plus grande MARGE — pas forcément celle où il est mauvais, mais
     celle où il lui reste le plus à prendre. C'est vrai qu'il soit
     au-dessus ou en dessous, et c'est l'axe que l'étape 03 décomposera. */
  const AN=dkAnalyse(my, clanRows);
  const h2 = AN
    ? { n:2, etape:t("Ce qui te freine"),
        titre: AN.tousBons ? t("Tes trois contributions tiennent.")
                           : t(AN.faible.manque),
        ligne: AN.faible && AN.faible.marge>0
          ? t("Au niveau {s}, cette seule contribution te rapporterait {n} par bataille.")
              .replace("{s}", AN.faible.qui==="adv"?t("des adversaires"):t("du clan"))
              .replace("{n}", fmt(Math.round(AN.faible.ref-AN.faible.moi)))
          : t("Ta plus petite avance est sur {s} — c'est là qu'il reste le plus à prendre.")
              .replace("{s}", t(AN.faible.avec)),
        fond:(F(1)||{}).k,
        fig:dkBarres(AN.axes.map(a=>({cle:a.cle, nom:a.nom, unite:"n", moi:a.moi, ref:a.ref})),
                     AN.faible?AN.faible.cle:null,
                     (AN.faible && AN.faible.marge>0)?"fuite":"vise"),
        stats: AN.faible ? [
          {v:fmt(Math.round(AN.faible.moi)), l:t("toi"), ton:AN.faible.marge>0?"dn":"up"},
          {v:AN.faible.ref!=null?fmt(Math.round(AN.faible.ref)):"—",
           l:AN.faible.qui==="adv"?t("les adversaires"):t("le clan")},
          /* Retard ou avance : le mot suit le signe. « Marge » disait
             l inverse de la verite quand le joueur etait au-dessus. */
          AN.faible.marge!=null?{v:Math.round(Math.abs(AN.faible.marge)*100)+" %",
           l:AN.faible.marge>0?t("de retard"):t("d'avance"),
           ton:AN.faible.marge>0?"dn":"up"}:null,
        ] : [] }
    : { n:2, etape:t("Ce qui te freine"), titre:t("Pas encore assez de batailles."),
        ligne:t("Il faut trente obus tirés et huit batailles pour comparer tes contributions."),
        fond:(F(1)||{}).k, stats:[] };

  /* ── 03 ── POURQUOI : la décomposition de l'axe désigné ───────────
     Le panneau ne dit plus OÙ mais POURQUOI, et il décompose l'axe que
     le 02 vient de désigner. « Ta pénétration décroche » ne distinguait
     pas tirer peu, tirer mal et tirer sur les mauvaises cibles — trois
     conseils incompatibles. */
  const h3 = (AN && AN.fuite)
    ? { n:3, etape:t("Pourquoi"), titre:t(DK_FUITE_TITRE[AN.fuite.cle]||"Ce qui fuit."),
        ligne:t("Au niveau {s} sur ce seul point, tu gagnerais {n} par bataille.")
                .replace("{s}", AN.fuite.qui==="adv"?t("des adversaires"):t("du clan"))
                .replace("{n}", fmt(Math.round(AN.fuite.gain))),
        fond:(F(2)||{}).k, fig:dkBarres(AN.faible.etages, AN.fuite.cle),
        stats:[
          {v:(AN.fuite.unite==="%"?pctf(AN.fuite.moi):fmt(Math.round(AN.fuite.moi))),
           l:t("toi"), ton:"dn"},
          {v:(AN.fuite.unite==="%"?pctf(AN.fuite.ref):fmt(Math.round(AN.fuite.ref))),
           l:AN.fuite.qui==="adv"?t("les adversaires"):t("le clan")},
          {v:"+"+fmt(Math.round(AN.fuite.gain)), l:t("dégâts en jeu"), ton:"up"},
        ]}
    : AN && AN.faible
    ? { n:3, etape:t("Pourquoi"), titre:t("Rien ne fuit."),
        ligne:t("Aucun étage ne décroche assez pour valoir un changement."),
        fond:(F(2)||{}).k, fig:dkBarres(AN.faible.etages, null), stats:[] }
    : { n:3, etape:t("Pourquoi"), titre:t("Pas encore assez d'obus."),
        ligne:t("Il faut trente obus tirés et huit batailles pour décomposer tes contributions."),
        fond:(F(2)||{}).k, stats:[] };

  /* ── 04 ── la preuve */
  let t4, l4;
  if(tr && tr.delta>=15){ t4=t("Ça monte."); l4=t("Ta seconde moitié de saison dépasse la première."); }
  else if(tr && tr.delta<=-15){ t4=t("Ça recule."); l4=t("Ta seconde moitié de saison est sous la première."); }
  else if(tr){ t4=t("Ça tient."); l4=t("Ton niveau ne bouge pas franchement dans un sens ni dans l'autre."); }
  else { t4=t("Trop tôt pour le dire."); l4=t("La progression se lit à partir d'une dizaine de batailles."); }
  /* la courbe : moyenne glissante du SR, pour que le trait dise une
     tendance et non le hasard d'une bataille */
  const suite=my.slice().filter(r=>r.ts).sort((x,y)=>x.ts-y.ts);
  const k=Math.max(4, Math.round(suite.length/6));
  const pts=[];
  for(let i=k;i<=suite.length;i++){ const v=srAvg(suite.slice(i-k,i)); if(v!=null) pts.push(v); }
  const h4={ n:4, etape:t("Est-ce que ça marche"), titre:t4, ligne:l4,
    fond:(F(2)||{}).k, fig:dkCourbe(pts),
    /* Le point de depart compte autant que l'arrivee : « 1 573 » seul ne
       dit pas si l'on monte. Les trois ensemble racontent le trajet. */
    stats: tr?[
      {v:(tr.delta>=0?"+":"−")+Math.abs(tr.delta), l:t("de SR"), ton:tr.delta>=0?"up":"dn"},
      {v:fmt(tr.older), l:t("au départ")},
      {v:fmt(tr.recent), l:t("aujourd'hui")},
    ]:[] };

  /* ── 05 ── le bilan */
  const h5={ n:5, etape:t("Le bilan"), titre: sr!=null?fmt(sr):t("Pas encore de SR"),
    ligne: sr!=null
      ? (()=>{ const p=dkProchain(sr);
          return p ? esc(tier.l)+" — "+t("encore {n} pour « {s} ».")
                       .replace("{n}", fmt(p.reste)).replace("{s}", esc(p.nom))
                   : esc(tier.l); })()
      : t("Le SR se calcule à partir d'une dizaine de batailles."),
    fond:(F(3)||{}).k, fig:dkJauge(sr),
    /* Un classement se contemple, un objectif se vise : le rang pour
       situer, la marche suivante pour agir. */
    stats: sr!=null?[
      rang?{v:rang.rang+"<i>/"+rang.total+"</i>", l:t("dans le clan"),
            ton:rang.rang<=Math.ceil(rang.total/3)?"up":""}:null,
      (()=>{ const p=dkProchain(sr);
        return p?{v:"+"+fmt(p.reste), l:t("pour le palier suivant")}:null; })(),
      st?{v:st.n, l:st.res===1?t("victoires d'affilée"):t("défaites d'affilée"),
          ton:st.res===1?"up":"dn"}:null,
    ]:[] };

  /* L'emblème va sur les cinq. Le char seulement là où la figure lui
     laisse la place : sur l'étape 03 la carte occupe déjà la droite, et
     deux objets superposés ne font qu'une bouillie. */
  [h1,h2,h3,h4,h5].forEach(h=>{ h.emb=emb; });
  [h1,h2,h4,h5].forEach(h=>{ h.char=chr; });
  return [h1,h2,h3,h4,h5];
}

/* ═══════════════════════════════════════════════════════════════════
   LE MOTEUR DU PONT
   ═══════════════════════════════════════════════════════════════════ */
let dkN=1;          // l'étape affichée
let dkSens=1;       // 1 : on avance · −1 : on recule
let dkVu=false;     // l'entrée a-t-elle déjà été jouée une fois ?
let dkPos=0;        // la position de la piste, en pixels — la vérité
let dkRaf=0, dkPret=false;
const dkDoux=()=>matchMedia("(prefers-reduced-motion: reduce)").matches;
const dkL=()=>{ const v=document.getElementById("dkVp"); return v?v.clientWidth||1:1; };

function dkRemplit(my, clanRows){
  dkDonnees(my, clanRows).forEach(o=>{
    const el=document.getElementById("dkP"+o.n);
    if(el) el.innerHTML=dkPanneau(o);
  });
  dkArme();
  /* On RESTAURE l'étape au lieu de revenir à la première.
     La vue joueur est re-rendue à chaque redimensionnement de fenêtre
     (voir l'écouteur « resize » de l'application) : sans cela, agrandir
     la fenêtre, tourner un téléphone, ou ouvrir la console ramenait le
     joueur à l'étape 01 sans qu'il ait rien demandé. */
  const n=Math.max(1,Math.min(5,dkN||1));
  dkPos=(n-1)*dkL(); dkApplique(); dkActive(n);
}

/* ── Appliquer : une seule écriture par image affichée ──────────────
   x vaut 0 quand le panneau est centré, ±1 quand il est à une largeur
   d'écran. Trois vitesses, donc trois profondeurs — c'est ça, la
   parallaxe ; un seul calque qui glisse ne se remarque pas. */
function dkApplique(){
  const tr=document.getElementById("dkTrack");
  if(!tr) return;
  const L=dkL(), doux=dkDoux();
  tr.style.transform="translate3d("+(-dkPos).toFixed(2)+"px,0,0)";
  tr.querySelectorAll(".dk-p").forEach((p,i)=>{
    const x=Math.max(-1.4,Math.min(1.4,(i*L-dkPos)/L));
    const c=p.querySelector(".dk-c");
    if(doux){
      p.querySelectorAll(".dk-map,.dk-inst,.dk-em,.dk-char").forEach(e=>e.style.transform="");
      if(c){ c.style.transform=""; c.style.opacity=Math.abs(x)<.5?"1":"0"; }
    } else {
      /* Quatre vitesses, donc quatre profondeurs. L'ordre n'est pas
         arbitraire : ce qui est loin bouge peu, ce qui est près bouge
         beaucoup — c'est ce que fait le paysage vu d'un train. */
      const bouge=(s,v,ech)=>{ const e=p.querySelector(s); if(!e) return;
        e.style.transform="translate3d("+(x*v).toFixed(1)+"px,0,0)"+(ech?" scale("+ech+")":""); };
      bouge(".dk-em", -60);          // l'emblème, au fond
      bouge(".dk-map", -170, 1.22);  // le relief
      bouge(".dk-inst", 240);        // les instruments
      bouge(".dk-char", 130);        // le char, au premier plan
      if(c){
        /* Le panneau qui s'eloigne RECULE aussi : une translation seule
           fait glisser deux surfaces cote a cote, une reduction les met a
           deux profondeurs. C'est ce qui fait la difference entre un
           carrousel et un empilement. */
        const k=Math.min(1,Math.abs(x));
        c.style.transform="translate3d("+(x*110).toFixed(1)+"px,0,0) scale("+(1-k*0.055).toFixed(4)+")";
        c.style.opacity=String(Math.max(0,1-Math.abs(x)*1.45));
      }
    }
    /* Un panneau hors écran ne doit pas être atteignable au clavier :
       sinon la tabulation part dans le vide. */
    p.toggleAttribute("inert", Math.abs(x)>.5);
  });
}

/* ── Animer ────────────────────────────────────────────────────────
   Menée en JavaScript plutôt qu'en transition CSS : c'est la seule
   façon de connaître la position exacte à chaque image, donc de garder
   la parallaxe synchrone avec le déplacement. */
function dkAnime(vers){
  cancelAnimationFrame(dkRaf);
  if(dkDoux()){ dkPos=vers; dkApplique(); return; }
  const de=dkPos, delta=vers-de, t0=performance.now(), D=560;
  if(Math.abs(delta)<1){ dkPos=vers; dkApplique(); return; }
  const pas=now=>{
    const k=Math.min(1,(now-t0)/D);
    /* sortie cubique : départ franc, arrivée posée */
    dkPos=de+delta*(1-Math.pow(1-k,3));
    dkApplique();
    if(k<1) dkRaf=requestAnimationFrame(pas);
  };
  dkRaf=requestAnimationFrame(pas);
}

function dkVa(n, sec){
  n=Math.max(1,Math.min(5,n));
  /* Le sens du geste : le contenu entrera par la ou l'on vient. */
  dkSens = n>dkN ? 1 : (n<dkN ? -1 : dkSens);
  const vers=(n-1)*dkL();
  if(sec){ cancelAnimationFrame(dkRaf); dkPos=vers; dkApplique(); }
  else dkAnime(vers);
  dkActive(n);
}

function dkArme(){
  const vp=document.getElementById("dkVp");
  if(!vp || dkPret) { dkApplique(); return; }
  dkPret=true;

  document.getElementById("dkPrev").onclick=()=>dkVa(dkN-1);
  document.getElementById("dkNext").onclick=()=>dkVa(dkN+1);
  document.getElementById("dkNav").addEventListener("click", e=>{
    const b=e.target.closest("button[data-e]"); if(b) dkVa(+b.dataset.e);
  });

  /* « Voir le détail » descend la page : c'est le geste vertical, celui
     que la molette fait déjà. On ne détourne rien. */
  vp.addEventListener("click", e=>{
    const b=e.target.closest(".dk-more"); if(!b) return;
    const d=document.querySelector('.dk-d[data-n="'+b.dataset.e+'"]');
    if(d) d.scrollIntoView({behavior:dkDoux()?"auto":"smooth", block:"start"});
  });

  /* Le clavier. Sans lui, un carrousel n'existe qu'à la souris. */
  vp.addEventListener("keydown", e=>{
    if(e.key==="ArrowRight"||e.key==="PageDown"){ e.preventDefault(); dkVa(dkN+1); }
    if(e.key==="ArrowLeft"||e.key==="PageUp"){ e.preventDefault(); dkVa(dkN-1); }
    if(e.key==="Home"){ e.preventDefault(); dkVa(1); }
    if(e.key==="End"){ e.preventDefault(); dkVa(5); }
  });

  /* ── Le glisser ──────────────────────────────────────────────────
     Le doigt tient le rail, la parallaxe suit en direct. On ne prend la
     main qu'au-delà de 6 px ET si le geste est plutôt horizontal :
     au-dessous, c'est un clic ; à la verticale, c'est un défilement de
     page, et le voler est le premier motif d'abandon sur mobile.
     Aux bords, on divise la course par trois — la résistance dit « il
     n'y a rien de plus » mieux qu'un blocage net. */
  let ax=0, ay=0, base=0, presse=false, tire=false, juge=false, tms=0, tpos=0, vit=0;
  vp.addEventListener("pointerdown", e=>{
    if(e.target.closest("button")) return;
    presse=true; tire=false; juge=false;
    ax=e.clientX; ay=e.clientY; base=dkPos;
    tms=performance.now(); tpos=dkPos; vit=0;
    cancelAnimationFrame(dkRaf);
  });
  vp.addEventListener("pointermove", e=>{
    if(!presse) return;
    const dx=e.clientX-ax, dy=e.clientY-ay;
    if(!juge){
      if(Math.abs(dx)<6 && Math.abs(dy)<6) return;
      juge=true;
      if(Math.abs(dx)<=Math.abs(dy)){ presse=false; return; }  // geste vertical : on rend la main
      tire=true; vp.classList.add("tire");
      try{ vp.setPointerCapture(e.pointerId); }catch(_){}
    }
    if(!tire) return;
    e.preventDefault();
    const L=dkL(), max=4*L;
    let np=base-dx;
    if(np<0) np=np/3;
    else if(np>max) np=max+(np-max)/3;
    const now=performance.now(), dt=now-tms;
    if(dt>0){ vit=(np-tpos)/dt; tms=now; tpos=np; }
    dkPos=np; dkApplique();
  });
  const lache=()=>{
    if(!presse && !tire) return;
    presse=false;
    if(!tire) return;
    tire=false; vp.classList.remove("tire");
    const L=dkL();
    /* La vitesse compte autant que la distance : un geste bref et vif
       doit changer d'étape même s'il n'a pas parcouru la moitié. */
    let n=Math.round(dkPos/L)+1;
    if(Math.abs(vit)>0.45) n=(vit>0?Math.ceil(dkPos/L):Math.floor(dkPos/L))+1;
    dkVa(n);
  };
  vp.addEventListener("pointerup", lache);
  vp.addEventListener("pointercancel", lache);
  vp.addEventListener("lostpointercapture", lache);

  /* Au redimensionnement, la position en pixels ne veut plus rien dire :
     on la recalcule depuis l'étape, qui elle n'a pas changé. C'est tout
     l'intérêt de piloter le rail — le natif, lui, revenait au panneau 1. */
  addEventListener("resize", ()=>dkVa(dkN, true), {passive:true});

  dkApplique();
}

/* Changer d'étape, c'est aussi changer de détail : un seul est montré.
   C'est ce qui règle « il y a du texte partout ». */
/* ── Faire jouer l'entrée ────────────────────────────────────────
   On retire la classe, on force le recalcul, on la remet : sans ce
   passage par le recalcul, le navigateur ne voit aucun changement et
   l'animation ne rejoue pas quand on revient sur une étape déjà vue. */
function dkEntree(n){
  const p=document.getElementById("dkP"+n);
  if(!p || dkDoux()) return;
  /* Le sens passe au style : c'est lui qui decide de quel cote le
     contenu entre. Une variable CSS evite deux jeux de keyframes. */
  p.style.setProperty("--sens", dkSens>=0 ? "1" : "-1");
  /* Un seul panneau porte « vif » à la fois : sinon les quatre autres
     gardent leurs animations en fin de course et rien ne dit plus lequel
     est en scène. */
  document.querySelectorAll(".dk-p.vif").forEach(e=>e.classList.remove("vif"));
  void p.offsetWidth;
  p.classList.add("vif");

  /* La courbe : sa longueur n'existe qu'une fois le tracé dans la page. */
  const l=p.querySelector(".dkc-l");
  if(l && l.getTotalLength){
    const L=l.getTotalLength();
    l.style.transition="none";
    l.style.strokeDasharray=L; l.style.strokeDashoffset=L;
    requestAnimationFrame(()=>{ l.style.transition=""; l.style.strokeDashoffset="0"; });
  }
  p.querySelectorAll(".dk-s b[data-v]").forEach(b=>dkCompte(b));
  /* Le titre aussi, quand c'en est un — « 1 557 » qui monte depuis zéro
     se retient, « 1 557 » posé là ne se retient pas. On ne compte que
     s'il n'y a QUE des chiffres : « Steppes » ou « Ça monte. » n'ont
     rien à compter, et un titre à moitié animé serait pire que rien. */
  const ti=p.querySelector(".dk-t");
  if(ti && new RegExp("^[\\d\u0020\u00a0\u202f]+$").test(ti.textContent)) dkCompte(ti);
}

/* Compter un nombre jusqu'à sa valeur. On ne touche qu'aux chiffres :
   le signe, l'espace insécable et le « % » sont remis tels quels, sinon
   « −5 % » deviendrait « 5 » en cours de route. */
function dkCompte(el){
  /* On retient la valeur d'arrivée au premier passage : sans cela, un
     second comptage sur la même étape partirait d'un nombre en cours
     de route et n'atteindrait jamais la bonne valeur. */
  const brut=el.dataset.v||(el.dataset.v=el.innerHTML);
  /* Un nombre qui porte du balisage — « 18<i>/47</i> » — ne se compte pas :
     l'ecriture par textContent transformerait ses balises en texte
     litteral, et le lecteur verrait le code. On l'affiche tel quel. */
  if(brut.indexOf("<")>=0) return;
  /* Les séparateurs de milliers : espace, espace insécable, espace
     insécable étroite. fmt() emploie la dernière. On les nomme par
     leur point de code — écrites en clair, elles sont invisibles à la
     relecture et un gabarit les avale. */
  const SEP="\\u0020\\u00a0\\u202f";
  /* Les séparateurs ne sont admis qu'ENTRE deux groupes de chiffres :
     sinon la classe, gourmande, avale aussi l'espace qui précède le
     « % » et le pourcentage se recolle au nombre pendant le comptage. */
  const m=new RegExp("^(\\D*?)(\\d+(?:["+SEP+"]\\d+)*)(.*)$").exec(brut);
  if(!m) return;
  const cible=parseFloat(m[2].replace(new RegExp("["+SEP+"]","g"),""));
  if(!isFinite(cible) || cible===0){ el.textContent=brut; return; }
  const t0=performance.now(), D=780;
  const pas=now=>{
    /* Borné par le BAS aussi : l'horodatage passé par requestAnimationFrame
       est celui du début de l'image et peut précéder le t0 relevé juste
       avant. Sans ce plancher, le compte démarre en négatif. */
    const k=Math.max(0,Math.min(1,(now-t0)/D));
    const v=Math.round(cible*(1-Math.pow(1-k,3)));
    el.textContent=m[1]+fmt(v)+m[3];
    if(k<1) requestAnimationFrame(pas); else el.textContent=brut;
  };
  requestAnimationFrame(pas);
}

function dkActive(n){
  /* L entree ne rejoue QUE sur un vrai changement d etape. La vue joueur
     est re-rendue a chaque redimensionnement de fenetre : sans ce garde,
     le contenu du panneau repartait de zero et clignotait a chaque fois. */
  const change = (n!==dkN) || !dkVu;
  dkVu=true;
  dkN=n;
  const nav=document.getElementById("dkNav");
  if(nav) nav.querySelectorAll("button").forEach(b=>{
    const on=+b.dataset.e===n;
    b.classList.toggle("on", on);
    b.setAttribute("aria-current", on?"true":"false");
  });
  document.querySelectorAll(".dk-d").forEach(d=>{ d.hidden = +d.dataset.n !== n; });
  const p=document.getElementById("dkPrev"), q=document.getElementById("dkNext");
  if(p) p.disabled = n<=1;
  if(q) q.disabled = n>=5;
  if(change) dkEntree(n);
}

function coachDiag(mesRows, clanRows){
  const res=[];
  for(const g of COACH_GESTES){
    const m=g.calc(mesRows), c=g.calc(clanRows.filter(r=>r.accId!==SELP));
    if(!m||!c||!c.v) continue;
    const ecart=(m.v-c.v)/c.v;                       // relatif : comparable d'un geste à l'autre
    /* u vient du calcul, pas du geste : sans le reporter ici, tous les
       ratios s affichaient en 0.73 au lieu de 73 %. */
    res.push({...g, u:m.u, m:m.v, c:c.v, n:m.n, ecart, bon:ecart>=0});
  }
  /* on montre d'abord ce qui coûte le plus : les retards, par ampleur.
     Puis, s'il reste de la place, le point fort — pour ne pas n'énumérer
     que des reproches. */
  const retards=res.filter(r=>r.ecart<-0.04).sort((a,b)=>a.ecart-b.ecart);
  const forts  =res.filter(r=>r.ecart> 0.06).sort((a,b)=>b.ecart-a.ecart);
  return { retards, forts, total:res.length };
}


/* ── Les missions ──────────────────────────────────────────────────
   Chaque point faible devient un objectif chiffré. La cible n'est pas
   le niveau du clan d'un coup — ce serait décourageant — mais la
   MOITIÉ du chemin, arrondie. La progression se lit sur les dix
   dernières batailles : elle bouge parce que le joueur joue, pas parce
   qu'on l'anime. */
function pMissions(my, clanRows){
  const d=coachDiag(my, clanRows);
  if(!d.retards.length) return "";
  /* ⚠️ Deux paquets DISJOINTS : les dix dernières batailles, et tout ce
     qui précède. Comparer les dix dernières à une référence qui les
     contient condamnait la progression à zéro. */
  const tri=my.slice().sort((a,b)=>b.ts-a.ts);
  const recentes=tri.slice(0,10), avant=tri.slice(10);

  /* On ne garde que les gestes dont le niveau ANTÉRIEUR est sous celui du
     clan : sinon l'objectif calculé peut demander de reculer. */
  const eligibles=d.retards.map(g=>{
    const dep=g.calc(avant);
    return dep && dep.v < g.c ? {...g, base:dep.v} : null;
  }).filter(Boolean);
  if(!eligibles.length) return "";

  const cartes=eligibles.slice(0,3).map((g,i)=>{
    /* base vient du filtre ci-dessus : c'est le niveau du joueur AVANT
       ses dix dernières batailles, et il est garanti sous celui du clan. */
    const base=g.base, rec=g.calc(recentes);
    const cible=base+(g.c-base)/2;                     // la moitié du chemin
    const now=rec?rec.v:null;
    const suivi=(now!=null);
    /* 0 % au départ, 100 % à la cible ; on borne pour éviter les barres
       négatives quand le joueur régresse. */
    const av=suivi ? Math.max(0,Math.min(100,(cible-base)?((now-base)/(cible-base))*100:100)) : 0;
    const fait=suivi && now>=cible;
    /* 0 % peut vouloir dire « pas encore avancé » OU « reculé ». Le second
       mérite d'être dit : c'est une information, pas un échec. */
    const recul=suivi && !fait && now<base;
    const f=v=>g.u==="%"?pctf(v):(g.u==="s"?Math.round(v)+" s":v.toFixed(2));
    return '<article class="ms'+(fait?" ok":(recul?" rec":""))+'" style="--i:'+i+'">'+
      '<header><span class="ms-n">'+esc(g.nom)+'</span>'+
        (fait?'<span class="ms-b">réussie</span>'
         :recul?'<span class="ms-r">en recul</span>'
         :'<span class="ms-p">'+Math.round(av)+' %</span>')+'</header>'+
      '<div class="ms-o">Passer de <b>'+f(base)+'</b> à <b>'+f(cible)+'</b></div>'+
      '<div class="ms-j"><i style="width:'+av.toFixed(1)+'%"></i></div>'+
      '<footer>'+(suivi
        ? 'Sur tes 10 dernières : <b>'+f(now)+'</b>'+
          (recul?' — sous ton niveau de départ ('+f(base)+'). Reprends la fiche du geste.':'')
        : 'Il faut plus de 10 batailles pour mesurer une progression — joue, ça se lancera tout seul.')+'</footer>'+
    '</article>';
  }).join("");

  return '<section class="mss"><div class="mss-h">'+
    '<h3>Tes objectifs</h3>'+
    '<p>Chaque objectif vise la moitié du chemin vers le niveau du clan — atteignable, pas décourageant. La progression se met à jour sur tes dix dernières batailles.</p>'+
    '</div><div class="mss-g">'+cartes+'</div></section>';
}

function pCoach(mesRows, clanRows){
  if(!mesRows.length)
    return '<div class="coach"><div class="coach-vide">Aucune bataille sur cette période.</div></div>';
  const d=coachDiag(mesRows, clanRows);
  if(!d.total)
    return '<div class="coach"><div class="coach-vide">Pas encore assez de batailles pour comparer '+
      'quoi que ce soit. Les conseils apparaissent à partir d\'une dizaine de parties.</div></div>';

  const carte=(r,i)=>{
    const pct=Math.round(Math.abs(r.ecart)*100);
    const val=r.u==="%"?pctf(r.m):(r.u==="s"?Math.round(r.m)+" s":r.m.toFixed(2));
    const ref=r.u==="%"?pctf(r.c):(r.u==="s"?Math.round(r.c)+" s":r.c.toFixed(2));
    /* la barre situe le joueur par rapport au clan, plafonnée à ±50 %
       pour qu'un écart extrême n'écrase pas les autres */
    const pos=Math.max(-50,Math.min(50,r.ecart*100));
    return '<article class="coach-c '+(r.bon?"ok":"ko")+'" style="--i:'+i+'">'+
      '<header><span class="cc-n">'+esc(r.nom)+'</span>'+
        '<span class="cc-e">'+(r.bon?"+":"−")+pct+' %</span></header>'+
      '<div class="cc-j"><span class="cc-ref"></span><i style="'+
        (pos>=0?"left:50%;width:"+(pos)+"%":"right:50%;width:"+(-pos)+"%")+'"></i></div>'+
      '<div class="cc-v"><b>'+val+'</b><span>toi</span>'+
        '<b class="r">'+ref+'</b><span>le clan</span></div>'+
      '<p class="cc-t">'+r.constat(r.m,r.c)+'</p>'+
      (r.bon?"":'<p class="cc-a"><span>→</span>'+esc(r.action)+'</p>')+
      ficheHTML(r.cle)+
      '<footer>sur '+fmt(r.n)+' '+esc(r.ech||"batailles")+'</footer>'+
    '</article>';
  };

  let h='<div class="coach">';
  if(d.retards.length){
    h+='<div class="coach-t">Ce qui te coûte le plus</div>'+
       '<div class="coach-g">'+d.retards.slice(0,3).map((r,i)=>carte(r,i)).join("")+'</div>';
  }
  if(d.forts.length){
    h+='<div class="coach-t coach-t2">Ce sur quoi tu peux t\'appuyer</div>'+
       '<div class="coach-g">'+d.forts.slice(0,2).map((r,i)=>carte(r,i+3)).join("")+'</div>';
  }
  if(!d.retards.length && !d.forts.length)
    h+='<div class="coach-vide">Tu es dans la moyenne du clan sur les six gestes mesurés. '+
       'Rien de flagrant à corriger — le prochain gain viendra du jeu d\'équipe.</div>';
  h+='</div>';
  return h;
}

/* ── Verdict personnel ────────────────────────────────────────────
   Même grammaire que la Vue clan et les Batailles : une phrase, un
   chiffre, une tendance. La tendance compare les 30 derniers jours aux
   30 précédents — deux fenêtres de MÊME durée, sinon la comparaison ne
   veut rien dire. Sans fenêtre précédente exploitable, on n'affiche
   aucune tendance plutôt qu'une fausse. */
function pVerdict(my, clanRows){
  if(!my.length) return "";
  const now=Date.now()/1000;
  const F=(d,dec)=>my.filter(r=>r.ts && (now-r.ts) > (dec?d*86400:0) && (now-r.ts) <= (dec?2*d*86400:d*86400));
  const rec=F(30,false), pre=F(30,true);
  const moy=rs=>rs.length? rs.reduce((a,r)=>a+(r.dmg||0),0)/rs.length : null;
  const dRec=moy(rec), dPre=moy(pre);
  const dpts=(dRec!=null && dPre!=null && pre.length>=5) ? Math.round((dRec/dPre-1)*100) : null;

  const bat=new Set(my.map(r=>r.battleId)).size;
  const vic=new Set(my.filter(r=>r.result===1).map(r=>r.battleId)).size;
  const tot=new Set(my.filter(r=>r.result===1||r.result===0).map(r=>r.battleId)).size;
  const wr=tot?Math.round(vic/tot*100):0;

  let titre;
  if(dpts!=null && dpts>=8)       titre="Tu montes.";
  else if(dpts!=null && dpts<=-8) titre="Tu redescends.";
  else if(wr>=55)                 titre="Tu tiens ton niveau.";
  else                            titre="Tu cherches ton rythme.";

  let ph="<b>"+fmt(bat)+"</b> bataille"+(bat>1?"s":"")+" analysée"+(bat>1?"s":"")+
    ", <b>"+wr+" %</b> de victoires.";
  if(dpts!=null)
    ph+=" Tes dégâts sur 30 jours : <span class=\""+(dpts>=0?"up":"dn")+"\">"+
        (dpts>=0?"+":"−")+Math.abs(dpts)+" %</span> par rapport aux 30 jours précédents.";

  /* on réutilise le coach : le point fort et le point à travailler */
  try{
    const d=coachDiag(my, clanRows);
    if(d.forts.length)
      ph+=' Ton point fort : <span class="who">'+esc(d.forts[0].nom.toLowerCase())+"</span>.";
    if(d.retards.length)
      ph+=' À travailler en priorité : <span class="who">'+esc(d.retards[0].nom.toLowerCase())+"</span>.";
  }catch(e){ /* le verdict reste lisible sans */ }

  const dix=my.slice().sort((a,b)=>b.ts-a.ts).slice(0,10).reverse()
    .filter(r=>r.result===1||r.result===0)
    .map((r,j)=>'<i class="'+(r.result===1?"v":"d")+'" style="--i:'+j+';height:'+
         (r.result===1?26:14)+'px" title="'+(r.result===1?"Victoire":"Défaite")+'"></i>').join("");

  /* Le titre et le taux de victoire sont portés par le bandeau de
     l'étape 01, juste au-dessus. Les répéter ici doublait la page au
     lieu de la hiérarchiser. Reste ce que cette carte seule apporte :
     la phrase détaillée, et les dix dernières batailles. */
  return '<section class="vd" id="pVerdict">'+
    '<div class="vd-haut"><div class="vd-g">'+
      '<p class="vd-p">'+ph+'</p></div></div>'+
    (dix?'<div class="vd-c"><div class="vd-ch"><figcaption>Tes dix dernières batailles</figcaption>'+
      '<div class="vd-f">'+dix+'</div></div></div>':"")+
  '</section>';
}

function renderPlayerView(){
  const f=pfilter();
  const my=RAW.filter(r=>r.accId===SELP && f(r));
  const clanRows=RAW.filter(r=>r.isMember && f(r));
  const sel=document.getElementById("playerSel");
  const name=(my[0]&&my[0].name)||(sel.selectedOptions[0]?sel.selectedOptions[0].textContent:"—");
  const bw=battlesWinrate(my);
  const meMember=(MEMBERS||[]).find(m=>Number(m.account_id)===Number(SELP));
  const role=meMember?(ROLE_FR[normRole(meMember.wg_role)]||meMember.wg_role||""):"";
  const initials=(name||"?").replace(/[_\-]/g," ").trim().slice(0,2).toUpperCase();
  // Nombre de batailles écartées par le filtre de tier : c'est ce qui rend le
  // filtre compréhensible plutôt qu'inquiétant.
  {
    const tousRangs=RAW.filter(r=>r.accId===SELP);
    const hors=tousRangs.length-tousRangs.filter(estTierSR).length;
    const RANGS=[[10,"X"],[8,"VIII"],[6,"VI"]];
    document.getElementById("pTierSel").innerHTML=
      `<span class="ts-lab">Rang</span>
       <span class="ts-seg">${RANGS.map(([n,rn])=>
         n===SR_TIER ? `<span class="ts-b on">Tier ${rn}</span>`
                     : `<span class="ts-b off" title="Pas encore calibré">Tier ${rn}</span>`).join("")}</span>
       <span class="ts-note">${hors
         ? `${fmt(hors)} bataille${hors>1?"s":""} d'un autre rang ${hors>1?"sont écartées":"est écartée"} — le SR n'est calibré que sur le Tier ${RANGS[0][1]} pour l'instant.`
         : `Les autres rangs seront ouverts dès qu'ils auront assez de batailles pour être calibrés.`}</span>`;
  }
  { const el=document.getElementById("pVerdictHost");
    if(el) el.innerHTML = pVerdict(my, clanRows); }
  /* Sections qui ne peuvent rien dire : on les masque au lieu de les
     laisser en titres orphelins au-dessus du vide. */
  {
    const nBat = new Set(my.map(r=>r.battleId)).size;
    const assez = nBat >= 5;
    /* ⚠️ On ne touche à rien tant que la vue est verrouillée par
       wipGate() : les deux mécanismes se partagent `style.display`, et
       celui-ci réaffichait ce que l'autre venait de masquer — le membre
       voyait le bandeau « en construction » ET la moitié de la page. */
    const wipBloque = !!document.querySelector("#viewPlayer > .wip-msg");
    if(!wipBloque)
    /* Les en-têtes du fil (.fil-t) partent avec le reste : sinon un joueur
       sans assez de batailles verrait cinq titres et cinq promesses
       — « Ce qui te freine », « Où ça se joue » — au-dessus du vide.
       La station 01 garde le sien : c'est elle qui porte le message
       d'attente. */
    document.querySelectorAll("#viewPlayer .pz-title, #viewPlayer .pz-note, #viewPlayer .pz-diag, " +
      "#viewPlayer .pz-evo, #viewPlayer #pTanks, #viewPlayer #pDiff, #viewPlayer #pRecords, " +
      "#viewPlayer #pTravail, #viewPlayer #pTerrain, #viewPlayer #pMissions, " +
      "#viewPlayer .fil-e:not(:first-child) .et, #viewPlayer .et-lead, " +
      "#viewPlayer .pz-more, #viewPlayer #pSR")
      .forEach(e=>{ e.style.display = assez ? "" : "none"; });
    /* Une station dont tout le contenu est masqué ne doit pas laisser sa
       pastille numérotée seule sur le fil. */
    document.querySelectorAll("#viewPlayer .fil-e").forEach(e=>{
      const vivant = [...e.children].some(c=>c.style.display!=="none" &&
        (c.children.length || c.textContent.trim()));
      e.style.display = vivant ? "" : "none";
    });
    /* la carte d identite affiche « 0 % de victoire » en rouge quand il n y
       a rien : on la retire tant qu aucune bataille n est enregistree. */
    { const t=document.getElementById("pHead"); if(t) t.style.display = nBat ? "" : "none"; }
    let h = document.getElementById("pVideHost");
    if(!h){ h=document.createElement("div"); h.id="pVideHost";
      const a=document.getElementById("pVerdictHost"); a.parentNode.insertBefore(h, a.nextSibling); }
    h.innerHTML = assez ? "" : (nBat===0
      ? cpVide("🎯","Ton bilan personnel arrive",
          "Il se calcule sur tes batailles Bastion enregistrées par le mod. Joue-en quelques-unes et cette page se remplit toute seule.",
          [{fait:0,total:5,quoi:"batailles enregistrées"}])
      : cpVide("🎯","Encore quelques batailles",
          "Sous cinq batailles, une moyenne ne veut rien dire : un seul mauvais tour la fait basculer. "+
          "On préfère se taire plutôt que t'induire en erreur.",
          [{fait:nBat,total:5,quoi:"batailles enregistrées"}]));
  }
  document.getElementById("pHead").innerHTML=`
    <div class="pcard">
      <div class="pav">${esc(initials)}</div>
      <div class="pci">
        <h2>${esc(name)}${role?` <span class="role-badge">${esc(role)}</span>`:""}</h2>
        <!-- Le nombre de batailles et le taux de victoire sont dits par le
             verdict juste au-dessus, qui en tire une phrase. Les répéter ici
             n'apprenait rien et repoussait le travail vers le bas. -->
      </div>
    </div>`;

  if(!my.length){
    document.getElementById("pKpis").innerHTML='<div class="empty" style="grid-column:1/-1">Aucune bataille pour ce joueur sur la période.</div>';
    ["pSR","pDiag","pDecomp","pTanks","pEvo","pDiff","pRecords",
     "pByClass","pByTank","pByTier","pByMap","pCompare","pEnemies","pHidden","pPlan"]
      .forEach(id=>document.getElementById(id).innerHTML="");
    document.getElementById("pTrend").innerHTML=""; return;
  }
  const shots=my.reduce((s,r)=>s+r.shots,0),hits=my.reduce((s,r)=>s+r.hits,0);
  const prec=shots?hits/shots:0;
  const survrate=my.reduce((s,r)=>s+(r.surv?1:0),0)/my.length;
  const kpis=[
    {label:"Batailles",val:fmt(bw.battles)},
    {label:"Taux de victoire",val:pct(bw.wr),sub:bw.w+" V / "+(bw.t-bw.w)+" D"},
    {label:"Dégâts moyens",val:fmt(avgOf(my,"dmg"))},
    {label:"Frags moyens",val:fmt(avgOf(my,"kills"),2)},
    {label:"Survie",val:pct(survrate),sub:"temps moy "+fmtTime(avgOf(my,"life"))},
    {label:"Précision",val:pct(prec),sub:"encaissé "+fmt(avgOf(my,"dmgr"))+"/bat."},
  ];
  document.getElementById("pKpis").innerHTML=kpis.map(k=>
    `<div class="kpi"><div class="k-label">${k.label}</div><div class="k-val">${k.val}</div><div class="k-sub">${k.sub||""}</div></div>`).join("");

  // --- SR (Synergy Rating) : score + decomposition + tendance + serie ---
  const av=k=>avgOf(my,k);
  const myCE=playerCE(my), tier=ceTier(myCE);
  const tr=pSRTrend(my); let trendHtml="";
  if(tr){ const up=tr.delta>0, flat=Math.abs(tr.delta)<40;
    trendHtml=`<div class="sr-trend ${flat?'':(up?'tagpos':'tagneg')}">${flat?'➡️ stable':(up?'📈 en progression':'📉 en baisse')} <b>${tr.delta>0?'+':''}${tr.delta}</b> <span class="hint">(${tr.older} → ${tr.recent})</span></div>`; }
  const stk=pStreak(my); let stkHtml="";
  if(stk){ const w=stk.res===1, d=stk.res===-1, lbl=w?('victoire'+(stk.n>1?'s':'')):(d?('nul'+(stk.n>1?'s':'')):('défaite'+(stk.n>1?'s':'')));
    stkHtml=`<div class="sr-streak">Série en cours : <b class="${w?'tagpos':(d?'':'tagneg')}">${stk.n} ${lbl}</b></div>`; }
  const _acc = my[0] && my[0].accId;
  // ── 1. OÙ J'EN SUIS : le chiffre seul, sans rien pour le concurrencer.
  const _srP = (_acc!=null && srOk()) ? srByPlayer().get(Number(_acc)) : null;
  document.getElementById("pSR").innerHTML=`<div class="card sr-hero">
    <div class="sr-main"><div class="sr-big" style="color:${tier.c}">${fmt(myCE)}</div>
      <div class="sr-lab"><div class="sr-name" style="color:${tier.c}">${esc(tier.l)}</div>
      <div class="hint">${srHint()}</div>${trendHtml}${stkHtml}</div></div>
    ${srScale(myCE, _srP && _srP.marge)}</div>`;

  // ── 2. QUOI TRAVAILLER : le radar dit « où », les barres disent « combien ».
  // `bars` (l'ancienne décomposition en pourcentages) est retirée : le radar
  // porte la même information sous une forme lisible d'un coup d'œil.
  document.getElementById("pDiag").innerHTML   = srRadar(_acc);
  document.getElementById("pDecomp").innerHTML = srDecomp(_acc);

  // ── 3. EST-CE QUE JE PROGRESSE
  // Le conteneur est vide : sa largeur est celle de sa colonne, pas de son contenu.
  const _evo = document.getElementById("pEvo");
  _evo.innerHTML = srCurve(_acc, _evo.clientWidth);
  // Ces deux blocs portent leur propre période : un record filtré sur 7 jours
  // n'est pas un record, et « les 30 derniers jours » n'a aucun sens sous un
  // filtre de 7 jours. On garde en revanche le filtre de FORMAT — comparer une
  // performance 7v7 à une 15v15 ne veut rien dire.
  const myTout = RAW.filter(r=>r.accId===SELP && estTierSR(r) && (!state.mode || r.mode===state.mode));
  { const el=document.getElementById("pTravail"); if(el) el.innerHTML = pTravail(my, clanRows);
    const et=document.getElementById("pTerrain"); if(et) et.innerHTML = pTerrain(my, clanRows);
    const en=document.getElementById("pEntonnoir"); if(en) en.innerHTML = pEntonnoir(my, clanRows);
    const co=document.getElementById("pContrib"); if(co) co.innerHTML = pContributions(my, clanRows);
    dkRemplit(my, clanRows);
    const em=document.getElementById("pMissions"); if(em) em.innerHTML = pMissions(my, clanRows); }
  {
    /* Un titre orphelin au-dessus d'un « pas encore assez de données »
       occupe la page sans rien apprendre. La section s'efface entière
       et reviendra d'elle-même dès qu'un char atteindra le seuil. */
    const ht = pTanks(my);
    const el = document.getElementById("pTanks");
    el.innerHTML = ht;
    const vide = /class="[^"]*pt-vide|Aucun char n'atteint/.test(ht);
    const titre = el.previousElementSibling;
    el.style.display = vide ? "none" : "";
    if(titre && titre.classList.contains("pz-title")) titre.style.display = vide ? "none" : "";
  }
  document.getElementById("pDiff").innerHTML    = pDiff30(myTout);
  document.getElementById("pRecords").innerHTML = pRecords(myTout);

  // --- details de combat (collecte complete) ---
  const perfo=hits?my.reduce((s,r)=>s+r.pierce,0)/hits:0;
  const totLife=my.reduce((s,r)=>s+r.life,0);
  const dmgMin=totLife?my.reduce((s,r)=>s+r.dmg,0)/(totLife/60):0;
  const rec=my.reduce((m,r)=>Math.max(m,r.dmg),0);
  const enc=av("dmgr"), ratio=enc?av("dmg")/enc:0, capdef=av("cap")+av("decap");
  let hid=`<table class="mini"><tbody>
    <tr><td>Blindage encaissé (tanking)</td><td>${fmt(av("block"))}</td></tr>
    <tr><td>Dégâts assistés</td><td>${fmt(av("assist"))}</td></tr>
    <tr><td>Dégâts encaissés</td><td>${fmt(enc)}</td></tr>
    <tr><td>Ratio infligé / encaissé</td><td class="${ratio>=1?'tagpos':'tagneg'}">${fmt(ratio,2)}</td></tr>
    <tr><td>Précision / perforation</td><td>${pct(prec)} / ${pct(perfo)}</td></tr>
    <tr><td>Dégâts / minute de vie</td><td>${fmt(dmgMin)}</td></tr>
    <tr><td>Capture + défense</td><td>${fmt(capdef,1)}</td></tr>
    <tr><td>Record de dégâts</td><td>${fmt(rec)}</td></tr>`;
  if(av("maxhp")>0){
    const rend=av("maxhp")?av("dmg")/av("maxhp"):0, pvRest=av("maxhp")?av("hpleft")/av("maxhp"):0;
    const bRate=av("hitsr")?av("bounce")/av("hitsr"):0;
    hid+=`
    <tr><td>Rendement (dégâts ÷ PV du char)</td><td class="tagpos">${fmt(rend,2)}×</td></tr>
    <tr><td>PV restants moyens</td><td>${pct(pvRest)}</td></tr>
    <tr><td>Assist — repérage / chenilles / stun</td><td>${fmt(av("aradio"))} / ${fmt(av("atrack"))} / ${fmt(av("astun"))}</td></tr>
    <tr><td>Dégâts potentiels reçus</td><td>${fmt(av("pot"))}</td></tr>
    <tr><td>Coups reçus / perforés / rebonds</td><td>${fmt(av("hitsr"),1)} / ${fmt(av("piercer"),1)} / ${fmt(av("bounce"),1)}</td></tr>
    <tr><td>Taux de rebond encaissé</td><td>${pct(bRate)}</td></tr>
    <tr><td>Dégâts subis d'ennemis non repérés</td><td>${fmt(av("dmginvis"))}</td></tr>
    <tr><td>Dégâts à distance (sniper)</td><td>${fmt(av("sniper"))}</td></tr>
    <tr><td>Distance parcourue</td><td>${fmt(av("dist")/1000,2)} km</td></tr>`;
  } else {
    hid+=`<tr><td colspan="2" class="hint" style="padding-top:8px">Rendement, assist détaillé, PV, portée, distance… arrivent dès tes prochaines batailles Bastion avec le mod à jour.</td></tr>`;
  }
  hid+="</tbody></table>";
  document.getElementById("pHidden").innerHTML=hid;

  // --- par classe ---
  const byClass=groupRows(my,r=>r.cls);
  renderMiniPerf("pByClass",byClass,clsFR,"Classe");
  // --- par char ---
  // La carte annonce « les plus joués » : on trie donc par nombre de batailles,
  // pas par dégâts, sinon le tableau ne montre pas ce que son titre promet.
  const byTank=groupRows(my,r=>r.tank).sort((a,b)=>b.n-a.n).slice(0,8);
  renderMiniPerf("pByTank",byTank,x=>x,"Char");
  // --- par carte ---
  const byMap=groupRows(my,r=>r.mapName);
  renderMiniPerf("pByMap",byMap,prettyMap,"Carte");
  // --- par tier ---
  const byTier=groupRows(my,r=>{ const vm=VEHMAP[r.veh]; return (vm&&vm.tier)?("Tier "+vm.tier):""; })
    .sort((a,c)=>(parseInt(String(c.key).replace(/\D/g,""))||0)-(parseInt(String(a.key).replace(/\D/g,""))||0));
  renderMiniPerf("pByTier",byTier,x=>x,"Tier");

  // --- comparaison : toi vs moyenne clan vs MEILLEUR membre ---
  const clanAgg=aggregate(clanRows);
  const bestOf=k=>clanAgg.length?Math.max(...clanAgg.map(a=>a[k]||0)):0;
  const clS=clanRows.length?clanRows.reduce((s,r)=>s+(r.surv?1:0),0)/clanRows.length:0;
  const clanCE=clanAgg.length?Math.round(clanAgg.reduce((s,a)=>s+a.ce,0)/clanAgg.length):0;
  let cmp=`<table class="mini"><thead><tr><th>Métrique</th><th>Toi</th><th>Moy. clan</th><th>Meilleur</th><th>vs moy.</th></tr></thead><tbody>`;
  const cRow=(lab,me,cl,best,d,isPct)=>{ const g=v=>isPct?pct(v):fmt(v,d);
    const diff=cl?((me-cl)/cl*100):0, c=diff>=0?"tagpos":"tagneg";
    cmp+=`<tr><td>${lab}</td><td><b>${g(me)}</b></td><td>${g(cl)}</td><td>${g(best)}</td><td class="${c}">${diff>=0?"+":""}${Math.round(diff)}%</td></tr>`; };
  cRow("SR",myCE,clanCE,bestOf("ce"),0,false);
  cRow("Dégâts",av("dmg"),avgOf(clanRows,"dmg"),bestOf("dmg"),0,false);
  cRow("Frags",av("kills"),avgOf(clanRows,"kills"),bestOf("kills"),2,false);
  cRow("Assist",av("assist"),avgOf(clanRows,"assist"),bestOf("assist"),0,false);
  cRow("Blindage",av("block"),avgOf(clanRows,"block"),bestOf("block"),0,false);
  cRow("Repérage",av("spot"),avgOf(clanRows,"spot"),bestOf("spot"),1,false);
  cRow("Survie",survrate,clS,bestOf("survrate"),0,true);
  cmp+="</tbody></table>";
  document.getElementById("pCompare").innerHTML=cmp;

  // --- clans adverses ---
  const enemy={}; const seenB={};
  my.forEach(r=>{ if(r.battleId in seenB)return; seenB[r.battleId]=1;
    const tag=BATTLE_ENEMY[r.battleId]||"?"; (enemy[tag]=enemy[tag]||{w:0,t:0,n:0});
    enemy[tag].n++; if(r.result===1)enemy[tag].w++; if(r.result!==-1&&r.result!=null)enemy[tag].t++; });
  const elist=Object.keys(enemy).map(t=>({tag:t,n:enemy[t].n,wr:enemy[t].t?enemy[t].w/enemy[t].t:0}))
    .sort((a,b)=>a.wr-b.wr);
  if(!elist.length){ document.getElementById("pEnemies").innerHTML='<div class="empty">Aucun adversaire identifié</div>'; }
  else{ let e=`<table class="mini"><thead><tr><th>Clan adverse</th><th>Batailles</th><th>% Vict.</th></tr></thead><tbody>`;
    elist.forEach(x=>{ const ic=x.wr<0.4?"🔴":(x.wr>0.6?"🟢":"⚪"); const cl=x.wr<0.4?"tagneg":(x.wr>0.6?"tagpos":"");
      e+=`<tr><td>${ic} ${esc(x.tag)}</td><td>${x.n}</td><td class="${cl}">${pct(x.wr)}</td></tr>`; });
    e+="</tbody></table>"; document.getElementById("pEnemies").innerHTML=e; }

  // --- évolution : dégâts par bataille ---
  renderPTrend(my);
  // --- plan de progression ---
  renderPlan(name,my,byClass,byMap,elist,prec,survrate,av("dmg"),avgOf(clanRows,"dmg"),
    {myCE,clanCE,bestCE:bestOf("ce"),bestDmg:bestOf("dmg"),myDmg:av("dmg")});
}

function groupRows(rows,keyFn){
  const m={};
  rows.forEach(r=>{ const k=keyFn(r); if(k==null||k==="")return; (m[k]=m[k]||[]).push(r); });
  return Object.keys(m).map(k=>{ const rs=m[k]; const bw=battlesWinrate(rs);
    return {key:k, n:bw.battles, dmg:avgOf(rs,"dmg"), wr:bw.wr, kills:avgOf(rs,"kills"), sr:srAvg(rs)}; })
    .sort((a,b)=>b.dmg-a.dmg);
}
function renderMiniPerf(id,list,labelFn,head){
  const el=document.getElementById(id);
  if(!list.length){ el.innerHTML='<div class="empty">Pas encore de données</div>'; return; }
  // Le SR n'apparaît que s'il existe pour au moins une ligne : une colonne
  // entièrement remplie de « — » n'apprend rien et vole de la place.
  const avecSR=list.some(x=>x.sr!=null);
  let h=`<table class="mini"><thead><tr><th>${head}</th><th>Bat.</th><th>Dég. moy</th><th>% Vict.</th>${avecSR?"<th>SR</th>":""}</tr></thead><tbody>`;
  list.forEach(x=>{ h+=`<tr><td>${esc(labelFn(x.key))}</td><td>${x.n}</td><td>${fmt(x.dmg)}</td><td>${pct(x.wr)}</td>${
    avecSR?`<td>${x.sr==null?'<span style="color:var(--muted)">—</span>':fmt(x.sr)}</td>`:""}</tr>`; });
  h+="</tbody></table>"; el.innerHTML=h;
}
function renderPTrend(my){
  const svg=document.getElementById("pTrend");
  const W=svg.clientWidth||900,H=190,padL=42,padR=12,padT=14,padB=26;
  const pts=my.slice().filter(r=>r.ts).sort((a,b)=>a.ts-b.ts).map(r=>({t:r.ts,v:r.dmg}));
  if(pts.length<2){ svg.innerHTML=`<text x="${W/2}" y="${H/2}" text-anchor="middle" fill="var(--muted)">Pas assez de batailles pour une courbe</text>`; return; }
  const maxV=Math.max(...pts.map(p=>p.v))||1;
  const x=i=>padL+i/(pts.length-1)*(W-padL-padR), y=v=>padT+(1-v/maxV)*(H-padT-padB);
  let g="";
  for(let i=0;i<=4;i++){ const vv=maxV*i/4, yy=y(vv);
    g+=`<line class="grid-line" x1="${padL}" y1="${yy}" x2="${W-padR}" y2="${yy}"/>`;
    g+=`<text x="${padL-6}" y="${yy+3}" text-anchor="end" fill="var(--muted)" font-size="11">${fmt(vv)}</text>`; }
  let path="",area="M"+padL+","+(H-padB);
  pts.forEach((p,i)=>{ const px=x(i),py=y(p.v); path+=(i?"L":"M")+px+","+py+" "; area+="L"+px+","+py+" "; });
  area+="L"+x(pts.length-1)+","+(H-padB)+" Z";
  g+=`<path class="area" d="${area}"/><path class="line" d="${path}"/>`;
  pts.forEach((p,i)=>{ g+=`<circle class="dot" cx="${x(i)}" cy="${y(p.v)}" r="3"><title>${fmt(p.v)} dégâts</title></circle>`; });
  g+=`<line class="axis-line" x1="${padL}" y1="${H-padB}" x2="${W-padR}" y2="${H-padB}"/>`;
  svg.innerHTML=g;
}
/* ============================================================
   PLAN DE PROGRESSION
   Il découle du diagnostic, il ne le double pas : le radar dit QUEL axe est
   faible, le plan dit QUOI FAIRE et DE COMBIEN. Une seule priorité mise en
   avant — une liste de huit conseils au même poids ne se travaille pas.
   ============================================================ */
const PLAN_AXES={
  deg:{nom:"Dégâts", champ:r=>r.dmg, unite:"dégâts par bataille",
    cause:"Tu infliges moins que ce qu'on attend de ton rôle.",
    quoi:["Cherche les fenêtres de tir plutôt que les duels ouverts : trois obus tirés depuis un angle sûr valent mieux qu'un échange frontal.",
          "Une grosse part des dégâts manquants sont des dégâts jamais tirés — reste à portée de la ligne au lieu de repositionner trop tôt."]},
  enc:{nom:"Encaissé", champ:r=>r.dmgr, unite:"dégâts encaissés par bataille",
    cause:"Tu absorbes moins que ta part : l'équipe encaisse à ta place.",
    quoi:["Prends le premier contact quand ton char est fait pour ça, mais en angle : encaisser utile, ce n'est pas mourir tôt.",
          "Reviens te montrer après avoir rechargé plutôt que d'attendre à couvert — un char caché ne protège personne."]},
  bli:{nom:"Blindage", champ:r=>r.block, unite:"dégâts bloqués par bataille",
    cause:"Ton blindage travaille peu : tu prends les coups plutôt que tu ne les renvoies.",
    quoi:["Travaille l'angle du char plutôt que la position : 20° de plus suffisent souvent à faire ricocher.",
          "En sortie de couvert, montre la joue la plus épaisse et rentre avant le deuxième tir."]},
  vis:{nom:"Vision", champ:r=>r.spot, unite:"dégâts par repérage",
    cause:"Tu vois peu pour l'équipe : les dégâts partent sur des cibles repérées par d'autres.",
    quoi:["Tiens un point de vision passive au lieu de suivre la ligne : rester immobile en buisson rapporte plus que d'avancer.",
          "Prends l'information tôt dans la partie — un repérage à la première minute oriente tout le reste."]},
  obj:{nom:"Objectif", champ:r=>r.cap+r.decap, unite:"points de base par bataille",
    cause:"Tu joues peu la base : en Bastion, le compteur gagne aussi des batailles.",
    quoi:["Quand l'échange est équilibré, entrer sur la base force l'adversaire à venir — c'est souvent plus rentable que de chercher un dernier duel.",
          "Surveille le décapage : reprendre trois points au bon moment vaut un char sauvé."]},
};
function planPriorite(accId,rows){
  if(accId==null||!srOk()) return null;
  const a=srAptitudes(accId); if(!a) return null;
  const M=SR_MODEL["7v7"], S=(M&&M.seuils)||{aucun:10};
  if(a.n<S.aucun) return null;
  const tri=SR_AXES.map(([k,nom])=>({k,nom,v:a.val[k]})).sort((x,y)=>x.v-y.v);
  const faible=tri[0], fort=tri[tri.length-1];
  if(faible.v>=0.9) return {fort, faible:null};        // rien de vraiment faible
  const A=PLAN_AXES[faible.k]; if(!A) return {fort, faible:null};
  const moy=rows.length?rows.reduce((s,r)=>s+A.champ(r),0)/rows.length:0;
  // La part et la valeur brute ne sont pas proportionnelles (elles dépendent du
  // total de l'équipe) : la cible est donnée comme un ordre de grandeur, pas
  // comme une promesse au point près.
  const cible = faible.v>0.05 ? moy/faible.v : 0;
  return {fort, faible:{...faible, A, moy, cible, manque:Math.round((1/faible.v-1)*100)}};
}
function renderPlan(name,my,byClass,byMap,elist,prec,survrate,myDmg,clanDmg,obj){
  const b=[];
  // ── Secondaire : le contexte, une observation par sujet, sans redite.
  if(byClass.length>1){ const best=byClass[0], worst=byClass[byClass.length-1];
    if(worst.dmg < best.dmg*0.7)
      b.push(`En <b>${clsFR(worst.key)}</b> tes dégâts tombent à ${fmt(worst.dmg)}, contre ${fmt(best.dmg)} en <b>${clsFR(best.key)}</b>. Privilégie le second en compétition.`); }
  /* La carte la plus difficile est traitée par la station « Où ça se
     joue », avec sa vue du dessus et un seuil de quatre batailles. La
     répéter ici sans seuil produisait une contradiction : la station
     disait Steppes à 40 %, le plan Karelia à 0 % sur deux parties. */
  if(elist.length){ const dang=elist.filter(e=>e.n>=3)[0];
    if(dang && dang.wr<0.4) b.push(`Contre <b>${esc(dang.tag)}</b> tu tombes à ${pct(dang.wr)} de victoire. Un adversaire qui mérite une stratégie préparée.`); }
  if(prec<0.6) b.push(`Précision à ${pct(prec)} : tirs à l'arrêt et points faibles convertiraient plus d'obus en dégâts.`);
  if(survrate<0.4) b.push(`Tu ne survis qu'à ${pct(survrate)} des batailles — beaucoup d'impact perdu en fin de partie.`);

  // ── Priorité : l'axe le plus faible du radar, avec l'ordre de grandeur du manque.
  const _acc = my[0] && my[0].accId;
  const P = planPriorite(_acc, my);
  let tete="";
  if(P && P.faible){
    const F=P.faible;
    tete=`<div class="pl-prio">
      <div class="pl-tag">à travailler en priorité</div>
      <div class="pl-t">${F.nom} <span class="pl-x">${nb2(F.v)}×</span></div>
      <p class="pl-c">${F.A.cause} Il te manque environ <b>${F.manque} %</b> sur cet axe
        ${F.moy>0?` — de ${fmt(F.moy)} à ~${fmt(F.cible)} ${F.A.unite}`:""}.</p>
      <ul class="pl-q">${F.A.quoi.map(q=>`<li>${q}</li>`).join("")}</ul></div>`;
  } else if(P && P.fort){
    tete=`<div class="pl-prio pl-ok">
      <div class="pl-tag">rien de faible</div>
      <p class="pl-c">Aucun de tes cinq axes ne décroche sous la médiane de ton rôle.
        Ton point fort reste <b>${P.fort.nom}</b> (${nb2(P.fort.v)}×) — c'est là qu'il faut creuser l'écart.</p></div>`;
  }

  // ── Objectif chiffré : le palier suivant, une seule cible à la fois.
  const goals=[];
  if(obj && obj.myCE!=null){
    const next=SR_SEUILS.find(p=>p>obj.myCE);
    if(next) goals.push(`Encore <b>+${fmt(next-obj.myCE)}</b> de SR pour atteindre <b>${fmt(next)}</b> — « ${esc(ceTier(next).l)} ».`);
    if(obj.bestCE && obj.bestCE>obj.myCE+40)
      goals.push(`Le meilleur du clan est à <b>${fmt(obj.bestCE)}</b>.`);
  }
  if(obj && obj.bestDmg && obj.myDmg && obj.bestDmg>obj.myDmg*1.03)
    goals.push(`Dégâts : <b>${fmt(obj.myDmg)}</b> aujourd'hui, <b>${fmt(obj.bestDmg)}</b> pour le meilleur du clan.`);
  const goalsHtml = goals.length
    ? `<div class="plan-goals"><div class="pg-h">Objectif</div><ul>${goals.map(g=>`<li>${g}</li>`).join("")}</ul></div>` : "";

  const suite = b.length
    ? `<div class="pl-next">Ensuite</div><ul>${b.slice(0,3).map(x=>`<li>${x}</li>`).join("")}</ul>` : "";
  document.getElementById("pPlan").innerHTML = tete + suite + goalsHtml;
}

/* ============================================================
   LINE-UPS (compos de manoeuvre) — création réservée aux officiers+
   ============================================================ */
const LU_DAYS=["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];
const LU_DAY_NAMES=["lundi","mardi","mercredi","jeudi","vendredi","samedi","dimanche"];
const LU_FORMAT_LABELS={bastion10:"Bastion T10",bastion8:"Bastion T8",manoeuvres:"Manœuvres"};
const LU_ROLES=[["Stratège","📯"],["Soldat","⚔"]];
const LU_MAX_PLAYERS=10;
const LU_MANAGER_ROLES=new Set(["commander","deputy_commander","executive_officer","combat_officer","personnel_officer",
  "recruitment_officer","intelligence_officer","quartermaster","junior_officer"]);
const LU_MAPS=[
  ["","Carte à définir"],["lakeville","Lakeville"],["ensk","Ensk"],["redshire","Redshire"],
  ["himmelsdorf","Himmelsdorf"],["prohorovka","Prokhorovka"],["murovanka","Murovanka"],
  ["malinovka","Malinovka"],["ruinberg","Ruinberg"],["siegfriedline","Ligne Siegfried"],
  ["steppes","Steppes"],["tundra","Toundra"],["cliff","Falaise"],["fjord","Fjords"],
  ["fishingbay","Baie du pêcheur"],["erlenberg","Erlenberg"],["elhallouf","El Halluf"],
  ["karelia","Carélie"],["mannerheimline","Ligne Mannerheim"],["westfeld","Westfield"],["airfield","Aérodrome"]
];
let LINEUPS=[], LU_CANEDIT=false, LU_EDITING=null, LU_VIEWING_ID=null, LU_ATTENDING_ID=null, LU_SELECTED_DAY=null, LU_MONTH_CURSOR=null, LU_FORMAT="manoeuvres", LU_PREVIEW=false;
function luCurrentMember(){
  return (MEMBERS||[]).find(m=>Number(m.account_id)===Number(ME_ID))||null;
}
function luCurrentUserCanManage(){
  const me=luCurrentMember();
  return !!(DEV || (me&&LU_MANAGER_ROLES.has(normRole(me.wg_role))));
}
function luCanEditOwnAvailability(lu){
  if(ME_ID==null) return false;   // tout membre présent dans la line-up peut cocher SA propre ligne (officier inclus)
  return luCleanSlots(lu).some(s=>Number(s.account_id)===Number(ME_ID));
}
function luDateISO(d){
  const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function luMonday(value){
  const d=value?new Date(String(value).slice(0,10)+"T12:00:00"):new Date();
  const safe=Number.isNaN(d.getTime())?new Date():d;
  safe.setHours(12,0,0,0); safe.setDate(safe.getDate()-((safe.getDay()+6)%7));
  return safe;
}
function luWeekLabel(value){
  const a=luMonday(value),b=new Date(a); b.setDate(a.getDate()+6);
  const short=d=>d.toLocaleDateString(window.CP_LOC,{day:"numeric",month:"short"}).replace(".","");
  return `Semaine du ${short(a)} au ${short(b)} ${b.getFullYear()}`;
}
function luAvailability(slot){
  const src=Array.isArray(slot&&slot.availability)?slot.availability:(Array.isArray(slot&&slot.presence)?slot.presence:[]);
  return Array.from({length:7},(_,i)=>src[i]===true || src[i]===1 || src[i]==="1");
}
function luRoleName(value){ return String(value||"").toLowerCase().startsWith("strat")?"Stratège":"Soldat"; }
function luRoleOptions(selected){
  const current=luRoleName(selected);
  return LU_ROLES.map(([name,icon])=>`<option value="${name}" ${name===current?'selected':''}>${icon} ${name}</option>`).join("");
}
function luRoleLabel(value){
  const name=luRoleName(value),role=LU_ROLES.find(([n])=>n===name);
  return `${role?role[1]:""} ${name}`.trim();
}
function luMeta(lu){
  const slots=Array.isArray(lu&&lu.slots)?lu.slots:[], first=slots.find(s=>s&&s._type!=="meta")||{};
  return {
    format:String((lu&&lu.format)||first.format||"manoeuvres"),
    map:String((lu&&(lu.map||lu.map_name))||first.map||""),
    week_start:luDateISO(luMonday((lu&&lu.week_start)||first.week_start||null))
  };
}
function luCleanSlots(lu){
  const slots=Array.isArray(lu&&lu.slots)?lu.slots:[];
  return slots.filter(s=>s&&s._type!=="meta").map(s=>({
    account_id:s.account_id==null?"":s.account_id,name:s.name||"",position:luRoleName(s.position),
    tank:s.tank||"",availability:luAvailability(s)
  }));
}
function luMapLabel(id){ const x=LU_MAPS.find(m=>m[0]===String(id||"")); return x?x[1]:(id||"Carte à définir"); }
function showLuNotice(message,type){
  const el=document.getElementById("luNotice"); if(!el) return;
  el.textContent=message||""; el.className="lu-notice"+(type?" "+type:"")+(message?"":" hidden");
}
function luSortedMembers(){
  return (MEMBERS||[]).slice().sort((a,b)=>{
    if(Number(a.account_id)===Number(ME_ID)) return -1; if(Number(b.account_id)===Number(ME_ID)) return 1;
    const ra=ROLE_ORDER[normRole(a.wg_role)]??9,rb=ROLE_ORDER[normRole(b.wg_role)]??9;
    return ra-rb||String(a.nickname).localeCompare(String(b.nickname),"fr");
  });
}
function luRosterSlots(existing){
  const old=Array.isArray(existing)?existing:[],names=new Map(luSortedMembers().map(m=>[String(m.account_id),m.nickname]));
  return old.slice(0,LU_MAX_PLAYERS).map(s=>({...s,name:names.get(String(s.account_id))||s.name||""}));
}
function luFormatUI(){
  document.querySelectorAll("#luFormatTabs [data-lu-format]").forEach(b=>b.classList.toggle("on",b.dataset.luFormat===LU_FORMAT));
  const tier=document.getElementById("luTierLabel"),mode=document.getElementById("luModeLabel");
  if(tier) tier.textContent=LU_FORMAT==="bastion8"?"VIII":"X";
  if(mode) mode.textContent=LU_FORMAT==="manoeuvres"?"Manœuvres":"Bastion";
}
function wireLineupFormats(){
  document.querySelectorAll("#luFormatTabs [data-lu-format]").forEach(b=>b.onclick=()=>{
    LU_FORMAT=b.dataset.luFormat; luFormatUI(); renderLineups();
    if(LU_EDITING&&!document.getElementById("luEditor").classList.contains("hidden")){
      LU_EDITING.format=LU_FORMAT; renderLineupEditor();
    }
  });
  luFormatUI();
}
async function loadLineups(){
  const list=document.getElementById("luList");
  list.innerHTML='<div class="lu-empty">'+cpLoader()+'</div>'; wireLineupFormats();
  try{
    const r=await fnCall("lineups",{session:localStorage.getItem(LS_SESSION),action:"list"});
    if(!r.ok){ list.innerHTML='<div class="lu-empty"><div><b>Impossible de charger les line-ups</b>'+esc((r.j&&r.j.error)||String(r.status))+'</div></div>'; return; }
    LINEUPS=r.j.lineups||[];
    // Double verrou : le serveur doit autoriser l'écriture et le grade Wargaming
    // du membre connecté doit appartenir à la liste des officiers/commandants.
    LU_CANEDIT=(!!r.j.canEdit&&luCurrentUserCanManage())||DEV||isAppAdmin();
    document.getElementById("luNewBtn").classList.toggle("hidden",!LU_CANEDIT);
    document.getElementById("luRole").textContent = LU_CANEDIT
      ? "Ton grade permet de créer et modifier les line-ups du clan."
      : "Accès membre : tu peux consulter les line-ups et cocher uniquement tes propres disponibilités.";
    renderLineups();
  }catch(e){ list.innerHTML='<div class="lu-empty"><div><b>Connexion indisponible</b>'+esc(String(e))+'</div></div>'; }
}
function renderLineups(){
  const el=document.getElementById("luList");
  const list=LINEUPS.filter(lu=>luMeta(lu).format===LU_FORMAT);
  if(!list.length){
    el.innerHTML=`<div class="lu-empty"><div><b>Aucune line-up enregistrée</b>${LU_CANEDIT?'Crée la première semaine de présence avec le bouton « Nouveau line-up ».':'Les officiers n\'ont pas encore préparé cette composition.'}</div></div>`;
    return;
  }
  el.innerHTML='<div class="lu-list">'+list.map(lu=>{
    const meta=luMeta(lu),slots=luCleanSlots(lu),counts=LU_DAYS.map((_,i)=>slots.filter(s=>s.availability[i]).length);
    const total=counts.reduce((a,b)=>a+b,0),dots=counts.map((n,i)=>`<span class="${n?'on':''}" title="${LU_DAY_NAMES[i]} : ${n}">${LU_DAYS[i][0]}${n||''}</span>`).join("");
    const viewing=String(lu.id)===String(LU_VIEWING_ID),attending=String(lu.id)===String(LU_ATTENDING_ID);
    const mineHint=luCanEditOwnAvailability(lu)?'<span class="lu-mine-hint">Coche tes dispos ›</span>':"";
    const btns=`<div class="lu-card-actions"><span class="lu-card-openhint">${viewing?'● Ouvert':'Aperçu ›'}</span>${mineHint}${LU_CANEDIT?`<button class="btn" data-edit="${lu.id}">Modifier</button><button class="btn lu-del" data-del="${lu.id}">Supprimer</button>`:""}</div>`;
    return `<article class="lu-card ${viewing?'is-viewing':''}" data-view="${lu.id}" tabindex="0" ${viewing?'aria-current="true"':''} aria-label="Voir l’aperçu de ${esc(lu.name||"la line-up")}"><div class="lu-card-top">
      <div><div class="lu-card-name">${esc(lu.name||LU_FORMAT_LABELS[meta.format]||"Line-up")}</div><div class="lu-card-week">${esc(luWeekLabel(meta.week_start))}</div>
        <div class="lu-card-meta">${slots.length} joueur${slots.length>1?'s':''} · ${total} présence${total>1?'s':''}</div></div>
      <div><div class="lu-card-pres">${dots}</div></div>${btns}</div>${viewing?'<div class="lu-inline-host"><div class="lu-inline-inner"></div></div>':''}</article>`;
  }).join("");
  el.querySelectorAll("[data-view]").forEach(card=>{
    const open=()=>String(LU_VIEWING_ID)===String(card.dataset.view)?closeLineupPreview():openLineupPreview(LINEUPS.find(x=>String(x.id)===card.dataset.view));
    card.onclick=open;
    card.onkeydown=e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); open(); } };
  });
  el.querySelectorAll("[data-edit]").forEach(b=>b.onclick=e=>{e.stopPropagation();openLineupEditor(LINEUPS.find(x=>String(x.id)===b.dataset.edit));});
  el.querySelectorAll("[data-del]").forEach(b=>b.onclick=e=>{e.stopPropagation();deleteLineup(b.dataset.del);});
}
function openLineupPreview(lu){
  if(!lu) return;
  showLuNotice(""); LU_EDITING=null; LU_ATTENDING_ID=null; LU_VIEWING_ID=lu.id;
  const editor=document.getElementById("luEditor"); editor.classList.add("hidden"); editor.innerHTML="";
  renderLineups();
  const meta=luMeta(lu),slots=luCleanSlots(lu),counts=LU_DAYS.map((_,i)=>slots.filter(s=>s.availability[i]).length);
  const total=counts.reduce((a,b)=>a+b,0);
  const canMine=luCanEditOwnAvailability(lu);
  const rows=slots.map(s=>{
    const mine=ME_ID!=null && Number(s.account_id)===Number(ME_ID);
    const days=s.availability.map((v,i)=> (mine&&canMine)
      ? `<button type="button" class="lu-preview-day editable ${v?'on':''}" data-mine-day="${i}" title="${LU_DAY_NAMES[i]} — clique pour changer">${v?'✓':''}</button>`
      : `<span class="lu-preview-day ${v?'on':''}" aria-label="${v?'Présent':'Absent'}">${v?'✓':''}</span>`).join("");
    return `<div class="lu-preview-row${mine?' is-mine':''}"><span class="lu-preview-player">${esc(s.name||"Joueur")}${mine?' <em class="lu-me-tag">toi</em>':''}</span><span class="lu-preview-role">${esc(luRoleLabel(s.position))}</span>${days}</div>`;
  }).join("");
  const head=`<div class="lu-preview-row head"><span>Joueur</span><span>Rôle</span>${LU_DAYS.map((d,i)=>`<span class="lu-day-head">${d}<b class="lu-day-count" title="${counts[i]} présent${counts[i]>1?'s':''}">${counts[i]}</b></span>`).join("")}</div>`;
  const host=document.querySelector("#luList .lu-card.is-viewing .lu-inline-host"),inner=host&&host.querySelector(".lu-inline-inner");
  if(!host||!inner) return;
  const foot=canMine?'Coche directement <b>tes jours</b> ci-dessus : c’est enregistré automatiquement.':'Lecture seule — utilise « Modifier » pour changer la line-up.';
  inner.innerHTML=`<section class="lu-preview" aria-label="Aperçu de la line-up"><div class="lu-preview-head"><div><div class="lu-preview-kicker">Aperçu de la line-up</div><div class="lu-preview-name">${esc(lu.name||LU_FORMAT_LABELS[meta.format]||"Line-up")}</div><div class="lu-preview-meta"><span>${esc(LU_FORMAT_LABELS[meta.format]||meta.format)}</span><span>${esc(luWeekLabel(meta.week_start))}</span></div></div><button class="btn" id="luPreviewClose">Fermer</button></div>${lu.notes?`<div class="lu-preview-notes">${esc(lu.notes)}</div>`:""}<div class="lu-preview-scroll">${head}${rows||'<div class="lu-empty" style="border:0;min-height:68px"><div><b>Aucun joueur</b>Cette line-up ne contient pas encore de membre.</div></div>'}</div><div class="lu-preview-foot"><span>${slots.length} joueur${slots.length>1?'s':''} · ${total} disponibilité${total>1?'s':''}</span><span>${foot}</span></div></section>`;
  host.onclick=e=>e.stopPropagation(); host.onkeydown=e=>e.stopPropagation();
  inner.querySelectorAll("[data-mine-day]").forEach(b=> b.onclick=e=>{ e.stopPropagation(); toggleMyDay(lu,+b.dataset.mineDay,b); });
  host.querySelector("#luPreviewClose").onclick=e=>{e.stopPropagation();closeLineupPreview();};
  requestAnimationFrame(()=>host.classList.add("open"));
  host.closest(".lu-card").scrollIntoView({behavior:"smooth",block:"nearest"});
}
// Coche un jour de MA ligne directement dans l'aperçu et enregistre aussitôt (action attendance).
async function toggleMyDay(lu, day, btn){
  if(ME_ID==null) return;
  const slot=(lu.slots||[]).find(s=>Number(s.account_id)===Number(ME_ID));
  const cur=luAvailability(slot||{}), next=cur.slice(); next[day]=!next[day];
  btn.classList.toggle('on',next[day]); btn.textContent=next[day]?'✓':'';   // maj visuelle immédiate
  if(slot) slot.availability=next;
  luRefreshPreviewCounts(lu);
  if(LU_PREVIEW){ showLuNotice("✓ Disponibilité enregistrée (maquette).","good"); return; }
  const r=await fnCall("lineups",{session:localStorage.getItem(LS_SESSION),action:"attendance",id:Number(lu.id),availability:next});
  if(!r.ok){   // échec -> on annule la coche
    btn.classList.toggle('on',cur[day]); btn.textContent=cur[day]?'✓':''; if(slot) slot.availability=cur; luRefreshPreviewCounts(lu);
    showLuNotice("Impossible d'enregistrer : "+((r.j&&r.j.error)||r.status),"bad"); return;
  }
  showLuNotice("✓ Ta disponibilité est enregistrée.","good");
}
function luRefreshPreviewCounts(lu){
  const slots=luCleanSlots(lu),counts=LU_DAYS.map((_,i)=>slots.filter(s=>s.availability[i]).length);
  document.querySelectorAll("#luList .lu-card.is-viewing .lu-day-count").forEach((el,i)=>{ if(i<counts.length){ el.textContent=counts[i]; el.title=counts[i]+" présent"+(counts[i]>1?'s':''); } });
  const total=counts.reduce((a,b)=>a+b,0), foot=document.querySelector("#luList .lu-card.is-viewing .lu-preview-foot span");
  if(foot) foot.textContent=`${slots.length} joueur${slots.length>1?'s':''} · ${total} disponibilité${total>1?'s':''}`;
}
function openMyAvailability(lu){
  if(!lu||!luCanEditOwnAvailability(lu)){
    showLuNotice("Tu peux modifier uniquement ta propre ligne de disponibilités.","bad"); return;
  }
  showLuNotice(""); LU_EDITING=null; LU_VIEWING_ID=lu.id; LU_ATTENDING_ID=lu.id;
  const editor=document.getElementById("luEditor"); editor.classList.add("hidden"); editor.innerHTML="";
  renderLineups();
  const slots=luCleanSlots(lu),mine=slots.find(s=>Number(s.account_id)===Number(ME_ID));
  const host=document.querySelector("#luList .lu-card.is-viewing .lu-inline-host"),inner=host&&host.querySelector(".lu-inline-inner");
  if(!host||!inner||!mine) return;
  inner.innerHTML=`<section class="lu-self-editor" aria-label="Mes disponibilités"><div class="lu-self-head"><div><div class="lu-self-title">Mes disponibilités</div><div class="lu-self-sub">${esc(mine.name||"Mon compte")} · ${esc(luWeekLabel(luMeta(lu).week_start))}</div></div><button class="btn" id="luSelfClose">Fermer</button></div><div class="lu-self-days">${LU_DAYS.map((d,i)=>`<label class="lu-self-day">${d}<input class="lu-check" type="checkbox" data-self-day="${i}" ${mine.availability[i]?'checked':''} aria-label="Disponible ${LU_DAY_NAMES[i]}"></label>`).join("")}</div><div class="lu-self-actions"><button class="btn lu-self-save" id="luSelfSave">Enregistrer mes disponibilités</button></div></section>`;
  host.onclick=e=>e.stopPropagation(); host.onkeydown=e=>e.stopPropagation();
  host.querySelector("#luSelfClose").onclick=e=>{e.stopPropagation();closeLineupPreview();};
  host.querySelector("#luSelfSave").onclick=e=>{e.stopPropagation();saveMyAvailability(lu);};
  requestAnimationFrame(()=>host.classList.add("open"));
  host.closest(".lu-card").scrollIntoView({behavior:"smooth",block:"nearest"});
}
async function saveMyAvailability(lu){
  if(!lu||!luCanEditOwnAvailability(lu)){
    showLuNotice("Modification refusée : seule ta propre disponibilité peut être changée.","bad"); return;
  }
  const btn=document.getElementById("luSelfSave"),availability=Array.from(document.querySelectorAll("#luList [data-self-day]"),c=>c.checked);
  if(availability.length!==7) return;
  btn.disabled=true; btn.textContent="…";
  if(LU_PREVIEW){
    const slot=(lu.slots||[]).find(s=>Number(s.account_id)===Number(ME_ID));
    if(slot) slot.availability=availability;
    LU_ATTENDING_ID=null; LU_VIEWING_ID=null; renderLineups();
    showLuNotice("✓ Tes disponibilités sont enregistrées.","good"); return;
  }
  // Cette action ne transmet jamais le reste du tableau : le serveur peut ainsi
  // vérifier la session, le clan et le compte avant de modifier une seule ligne.
  const r=await fnCall("lineups",{session:localStorage.getItem(LS_SESSION),action:"attendance",id:Number(lu.id),availability});
  if(!r.ok){
    btn.disabled=false; btn.textContent="Enregistrer mes disponibilités";
    showLuNotice("Impossible d'enregistrer tes disponibilités : "+(r.j.error||r.status),"bad"); return;
  }
  LU_ATTENDING_ID=null; LU_VIEWING_ID=null; loadLineups();
}
function closeLineupPreview(){
  const id=LU_VIEWING_ID,host=document.querySelector("#luList .lu-card.is-viewing .lu-inline-host");
  if(host) host.classList.remove("open");
  setTimeout(()=>{if(String(LU_VIEWING_ID)===String(id)){LU_VIEWING_ID=null;LU_ATTENDING_ID=null;renderLineups();}},340);
}
function openLineupEditor(lu){
  if(!LU_CANEDIT){ showLuNotice("Ton grade ne permet pas de créer ou modifier une line-up.","bad"); return; }
  showLuNotice(""); LU_VIEWING_ID=null; LU_SELECTED_DAY=null; renderLineups();
  const meta=luMeta(lu||{});
  const slots=lu?luRosterSlots(luCleanSlots(lu)):Array.from({length:7},()=>({account_id:"",name:"",position:"Soldat",availability:Array(7).fill(false)}));
  LU_EDITING={id:lu&&lu.id||null,name:lu&&lu.name||"",notes:lu&&lu.notes||"",slots,
    format:lu?meta.format:LU_FORMAT,map:meta.map,week_start:meta.week_start,week_states:{}};
  saveLineupWeekState();
  LU_FORMAT=LU_EDITING.format; luFormatUI(); renderLineupEditor();
}
function renderLineupEditor(){
  const ed=document.getElementById("luEditor"); ed.classList.remove("hidden");
  const emb=ourEmblemUrl(), emblem=emb?`<img class="lu-summary-em" src="${esc(emb)}" alt="Emblème ${esc(CLANTAG||'du clan')}">`:`<div class="lu-summary-em lu-summary-em-ph">${esc(CLANTAG||'A-T-O')}</div>`;
  ed.innerHTML=`<div class="lu-editor-shell"><div class="lu-editor">
    <div class="lu-card-h"><h3>${LU_EDITING.id?"Modifier le line-up":"Nouveau line-up"}</h3><button class="btn" id="luCancel">Annuler</button></div>
    <div class="lu-form">
      <label class="lu-lab">Nom de la line-up<input id="luName" type="text" maxlength="80" value="${esc(LU_EDITING.name)}" placeholder="Ex : Manœuvres — Équipe 1"></label>
      <label class="lu-lab">Notes (facultatif)<input id="luNotes" type="text" maxlength="500" value="${esc(LU_EDITING.notes)}" placeholder="Consignes générales…"></label>
    </div>
    <div class="lu-weekbar"><button class="lu-week-nav" id="luWeekPrev" title="Semaine précédente">‹</button><button type="button" class="lu-week-pick" id="luWeekOpen" title="Choisir une semaine dans le mois"><span class="lu-week-pick-k">Choisir la semaine</span><b id="luWeekLabel">${esc(luWeekLabel(LU_EDITING.week_start))}</b></button><button class="lu-week-nav" id="luWeekNext" title="Semaine suivante">›</button></div>
    <div class="lu-month-picker hidden" id="luWeekMonth"></div>
    <div class="lu-attendance" id="luSlots"></div>
    <div class="lu-form-actions"><button class="btn" id="luAddSlot">＋ Ajouter une ligne</button><button class="btn lu-save" id="luSave">Valider la line-up</button></div>
  </div><aside class="lu-summary">${emblem}<div class="lu-summary-grid" id="luSummary"></div></aside></div>`;
  renderSlots();
  document.getElementById("luCancel").onclick=()=>{ed.classList.add("hidden");ed.innerHTML="";};
  document.getElementById("luName").oninput=e=>LU_EDITING.name=e.target.value;
  document.getElementById("luNotes").oninput=e=>LU_EDITING.notes=e.target.value;
  document.getElementById("luWeekPrev").onclick=()=>shiftLineupWeek(-7);
  document.getElementById("luWeekNext").onclick=()=>shiftLineupWeek(7);
  document.getElementById("luWeekOpen").onclick=()=>{
    const picker=document.getElementById("luWeekMonth"),opening=picker.classList.contains("hidden");
    picker.classList.toggle("hidden",!opening);
    if(opening){ const d=luMonday(LU_EDITING.week_start); LU_MONTH_CURSOR=new Date(d.getFullYear(),d.getMonth(),1); renderLineupMonthPicker(); }
  };
  document.getElementById("luAddSlot").onclick=()=>{
    if(LU_EDITING.slots.length>=LU_MAX_PLAYERS){ alert("Une line-up est limitée à "+LU_MAX_PLAYERS+" joueurs."); return; }
    LU_EDITING.slots.push({account_id:"",name:"",position:"Soldat",availability:Array(7).fill(false)});renderSlots();
  };
  document.getElementById("luSave").onclick=saveLineup;
  ed.scrollIntoView({behavior:"smooth",block:"start"});
}
function shiftLineupWeek(days){
  const d=luMonday(LU_EDITING.week_start); d.setDate(d.getDate()+days); selectLineupWeek(luDateISO(d));
}
function selectLineupWeek(value){
  if(!value||!LU_EDITING) return;
  saveLineupWeekState();
  LU_EDITING.week_start=luDateISO(luMonday(value));
  loadLineupWeekState(LU_EDITING.week_start);
  const lab=document.getElementById("luWeekLabel"); if(lab) lab.textContent=luWeekLabel(LU_EDITING.week_start);
  renderSlots();
}
function renderLineupMonthPicker(){
  const box=document.getElementById("luWeekMonth"); if(!box||!LU_EDITING) return;
  if(!LU_MONTH_CURSOR){ const d=luMonday(LU_EDITING.week_start); LU_MONTH_CURSOR=new Date(d.getFullYear(),d.getMonth(),1); }
  const y=LU_MONTH_CURSOR.getFullYear(),m=LU_MONTH_CURSOR.getMonth(),first=new Date(y,m,1),days=new Date(y,m+1,0).getDate();
  const leading=(first.getDay()+6)%7,selectedStart=luMonday(LU_EDITING.week_start),selectedEnd=new Date(selectedStart); selectedEnd.setDate(selectedStart.getDate()+6);
  const today=new Date(),wd=["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];
  let cells=Array.from({length:leading},()=>'<span class="lu-month-blank"></span>').join("");
  for(let day=1;day<=days;day++){
    const d=new Date(y,m,day,12),iso=luDateISO(d),inWeek=d>=selectedStart&&d<=selectedEnd;
    const cls=["lu-month-day",inWeek?"in-week":"",inWeek&&d.getDay()===1?"week-start":"",inWeek&&d.getDay()===0?"week-end":"",d.toDateString()===today.toDateString()?"today":""].filter(Boolean).join(" ");
    cells+=`<button type="button" class="${cls}" data-week-date="${iso}" title="Choisir la semaine du ${day}">${day}</button>`;
  }
  box.innerHTML=`<div class="lu-month-head"><button type="button" class="lu-month-nav" id="luMonthPrev">‹</button><div class="lu-month-title">${esc(capFirst(LU_MONTH_CURSOR.toLocaleDateString(window.CP_LOC,{month:"long",year:"numeric"})))}</div><button type="button" class="lu-month-nav" id="luMonthNext">›</button></div><div class="lu-month-grid">${wd.map(d=>`<span class="lu-month-wd">${d}</span>`).join("")}${cells}</div>`;
  document.getElementById("luMonthPrev").onclick=()=>{LU_MONTH_CURSOR=new Date(y,m-1,1);renderLineupMonthPicker();};
  document.getElementById("luMonthNext").onclick=()=>{LU_MONTH_CURSOR=new Date(y,m+1,1);renderLineupMonthPicker();};
  box.querySelectorAll("[data-week-date]").forEach(b=>b.onclick=()=>{selectLineupWeek(b.dataset.weekDate);box.classList.add("hidden");});
}
function lineupWeekSlotKey(slot,index){ return slot&&slot.account_id?"id:"+String(slot.account_id):"row:"+index; }
function saveLineupWeekState(){
  if(!LU_EDITING) return;
  LU_EDITING.week_states=LU_EDITING.week_states||{};
  const state={};
  (LU_EDITING.slots||[]).forEach((slot,index)=>state[lineupWeekSlotKey(slot,index)]=luAvailability(slot));
  LU_EDITING.week_states[LU_EDITING.week_start]=state;
}
function loadLineupWeekState(week){
  if(!LU_EDITING) return;
  const state=(LU_EDITING.week_states||{})[week]||null;
  (LU_EDITING.slots||[]).forEach((slot,index)=>{
    const saved=state&&state[lineupWeekSlotKey(slot,index)];
    slot.availability=saved?luAvailability({availability:saved}):Array(7).fill(false);
  });
}
function luMemberOptions(selected){
  const members=luSortedMembers();
  return `<option value="">Choisir un membre…</option>`+members.map(m=>`<option value="${m.account_id}" ${String(m.account_id)===String(selected)?'selected':''}>${esc(m.nickname)}</option>`).join("");
}
function renderSlots(){
  const box=document.getElementById("luSlots");
  const head=`<div class="lu-att-row lu-att-head"><span>N°</span><span class="lu-player-h">Joueur</span>${LU_DAYS.map((d,i)=>`<span class="lu-day-head">${d}<button type="button" class="lu-day-count ${i===LU_SELECTED_DAY?'on':''}" data-day-count="${i}" title="Voir les présents du ${LU_DAY_NAMES[i]}">0</button></span>`).join("")}<span class="lu-pos-h">Poste</span><span></span></div>`;
  const rows=LU_EDITING.slots.map((s,i)=>`<div class="lu-att-row lu-slot" data-i="${i}"><span class="lu-idx">${i+1}</span>
    <select class="lu-player">${luMemberOptions(s.account_id)}</select>
    ${LU_DAYS.map((d,di)=>`<label class="lu-day" title="Disponible ${LU_DAY_NAMES[di]}"><input class="lu-check" type="checkbox" data-day="${di}" ${s.availability[di]?'checked':''} aria-label="${LU_DAY_NAMES[di]}"></label>`).join("")}
    <select class="lu-pos" aria-label="Rôle du joueur">${luRoleOptions(s.position)}</select>
    <button class="icon-btn lu-rm" title="Retirer ce joueur">✕</button></div>`).join("");
  box.innerHTML=head+(rows||'<div class="lu-empty" style="min-height:66px;border:0"><div><b>Aucun joueur ajouté</b>Utilise « Ajouter un joueur » pour préparer l’équipe.</div></div>');
  box.querySelectorAll(".lu-slot").forEach(row=>{
    const i=+row.dataset.i;
    row.querySelector(".lu-player").onchange=e=>{ const op=e.target.selectedOptions[0]; LU_EDITING.slots[i].account_id=e.target.value; LU_EDITING.slots[i].name=e.target.value&&op?op.textContent:""; updateLineupSummary(); };
    row.querySelector(".lu-pos").onchange=e=>LU_EDITING.slots[i].position=luRoleName(e.target.value);
    row.querySelectorAll(".lu-check").forEach(c=>c.onchange=()=>{LU_EDITING.slots[i].availability[+c.dataset.day]=c.checked;updateLineupSummary();});
    row.querySelector(".lu-rm").onclick=()=>{LU_EDITING.slots.splice(i,1);renderSlots();};
  });
  box.querySelectorAll("[data-day-count]").forEach(b=>b.onclick=()=>{LU_SELECTED_DAY=+b.dataset.dayCount;updateLineupSummary();});
  const add=document.getElementById("luAddSlot");
  if(add){ add.disabled=LU_EDITING.slots.length>=LU_MAX_PLAYERS; add.title=add.disabled?"Maximum "+LU_MAX_PLAYERS+" joueurs":"Ajouter un joueur"; }
  updateLineupSummary();
}
function collectSlots(){
  return (LU_EDITING.slots||[]).map(s=>({account_id:s.account_id?Number(s.account_id):null,name:s.name||"",tank:s.tank||"",
    position:luRoleName(s.position),availability:luAvailability(s),format:LU_EDITING.format,map:LU_EDITING.map,week_start:LU_EDITING.week_start}));
}
function updateLineupSummary(){
  if(!LU_EDITING) return;
  const slots=(LU_EDITING.slots||[]).filter(s=>s.account_id),counts=LU_DAYS.map((_,i)=>slots.filter(s=>s.availability&&s.availability[i]).length);
  document.querySelectorAll("#luSlots [data-day-count]").forEach(b=>{const i=+b.dataset.dayCount,n=counts[i]||0;b.textContent=n;b.title="Voir les "+n+" présent"+(n>1?"s":"")+" du "+LU_DAY_NAMES[i];b.classList.toggle("on",i===LU_SELECTED_DAY);});
  const el=document.getElementById("luSummary"); if(!el) return;
  const confirmed=counts.reduce((a,b)=>a+b,0),possible=slots.length*7,pct=possible?Math.round(confirmed/possible*100):0;
  const best=Math.max(0,...counts),bestIndex=counts.indexOf(best);
  const selected=Number.isInteger(LU_SELECTED_DAY)?LU_SELECTED_DAY:null;
  const daySlots=selected===null?[]:slots.filter(s=>s.availability&&s.availability[selected]);
  const dayDetail=selected===null
    ? `<div class="lu-day-detail"><div class="lu-day-help">Clique sur le chiffre sous un jour pour afficher les joueurs disponibles.</div></div>`
    : `<div class="lu-day-detail"><div class="lu-day-detail-value"><span class="lu-day-detail-day">${esc(LU_DAY_NAMES[selected])}</span><span class="lu-day-detail-number">${daySlots.length}<small>${daySlots.length===1?'présent':'présents'}</small></span></div></div>`;
  el.innerHTML=`<div class="lu-summary-stat"><div class="lu-summary-l">Joueurs sélectionnés</div><div class="lu-summary-v">${slots.length} <small>/ ${LU_MAX_PLAYERS}</small></div></div>
    <div class="lu-summary-stat"><div class="lu-summary-l">Disponibilités confirmées</div><div class="lu-summary-v">${confirmed} <small>/ ${possible}</small></div></div>
    <div class="lu-summary-stat"><div class="lu-summary-l">Meilleur jour</div><div class="lu-summary-best">${best?LU_DAY_NAMES[bestIndex]+" · "+best+" présent"+(best>1?"s":""):"À confirmer"}</div>
      <div class="lu-progress" title="Préparation ${pct} %"><span style="width:${pct}%"></span></div><div class="lu-summary-l" style="margin-top:4px">Préparation ${pct} %</div></div>${dayDetail}`;
}
async function saveLineup(){
  if(!LU_CANEDIT){ showLuNotice("Enregistrement refusé : cette action est réservée aux officiers et commandants.","bad"); return; }
  const slots=collectSlots().filter(s=>s.account_id);
  showLuNotice("");
  if(!slots.length){ showLuNotice("Ajoute au moins un membre avant de valider la line-up.","bad"); return; }
  if(slots.length>LU_MAX_PLAYERS){ showLuNotice("Une line-up est limitée à "+LU_MAX_PLAYERS+" joueurs.","bad"); return; }
  if(new Set(slots.map(s=>s.account_id)).size!==slots.length){ showLuNotice("Le même membre est sélectionné plusieurs fois. Choisis un joueur différent sur chaque ligne.","bad"); return; }
  const payload={id:LU_EDITING.id||null,name:(LU_EDITING.name||"").trim()||LU_FORMAT_LABELS[LU_EDITING.format]||"Line-up",
    notes:(LU_EDITING.notes||"").trim(),slots};
  const btn=document.getElementById("luSave"); btn.disabled=true; btn.textContent="…";
  if(LU_PREVIEW){
    const demo={...payload,id:payload.id||Date.now(),created_by_name:"BeNoBaX"};
    const pos=LINEUPS.findIndex(x=>String(x.id)===String(demo.id));
    if(pos>=0) LINEUPS[pos]=demo; else LINEUPS.unshift(demo);
    document.getElementById("luEditor").classList.add("hidden"); document.getElementById("luEditor").innerHTML="";
    renderLineups(); showLuNotice("✓ Line-up validée dans la maquette.","good");
    document.getElementById("luNotice").scrollIntoView({behavior:"smooth",block:"center"}); return;
  }
  const r=await fnCall("lineups",{session:localStorage.getItem(LS_SESSION),action:"save",lineup:payload});
  if(!r.ok){ btn.disabled=false; btn.textContent="Valider la line-up"; showLuNotice("Erreur pendant l’enregistrement : "+(r.j.error||r.status),"bad"); return; }
  document.getElementById("luEditor").classList.add("hidden"); document.getElementById("luEditor").innerHTML="";
  loadLineups();
}
async function deleteLineup(id){
  if(!LU_CANEDIT){ showLuNotice("Suppression refusée : cette action est réservée aux officiers et commandants.","bad"); return; }
  if(!confirm("Supprimer ce line-up ?")) return;
  if(LU_PREVIEW){ LINEUPS=LINEUPS.filter(x=>String(x.id)!==String(id)); renderLineups(); return; }
  const r=await fnCall("lineups",{session:localStorage.getItem(LS_SESSION),action:"delete",id:Number(id)});
  if(!r.ok){ alert("Erreur : "+(r.j.error||r.status)); return; }
  loadLineups();
}

/* ============================================================
   LOADOUTS (equipements/consommables recommandes par char) — officiers+
   ============================================================ */
let LOADOUTS=[], LO_CANEDIT=false, LO_REF=null, LO_WIZ=null, LO_NEW=false;
// Les competences sont stockees par role d'equipage (5 roles). On aplatit pour l'affichage des cartes.
const CREW_ROLES=[["commander","Chef de char"],["gunner","Tireur"],["driver","Pilote"],["radioman","Opérateur radio"],["loader","Chargeur"]];
const CREW_FR={commander:"Chef de char",gunner:"Tireur",driver:"Pilote",radioman:"Opérateur radio",loader:"Chargeur"};
// Compétences universelles à NE PAS proposer sur les slots bonus (qualification supplémentaire).
const BONUS_HIDE=new Set(["brotherhood","repair","camouflage"]);
// Equipage par defaut si l'API ne renvoie pas le crew (4 membres, commander cumule la radio).
const DEFAULT_CREW=[{member_id:"commander",roles:{commander:1,radioman:1}},{member_id:"gunner",roles:{gunner:1}},{member_id:"driver",roles:{driver:1}},{member_id:"loader",roles:{loader:1}}];
function loFlatSkills(sk){
  if(Array.isArray(sk)) return sk;
  if(sk&&typeof sk==='object') return CREW_ROLES.reduce((a,r)=>a.concat(sk[r[0]]||[]),(sk.radio||[]));
  return [];
}
// Membres/roles d'un char -> liste de créneaux {role, cap, bonus}. cap=6 (rôle principal) / 3 (qualification suppl.).
function wizCrewSlots(){
  const M=loMaps(), t=M.t[LO_WIZ.tank_id]||{};
  const crew=(Array.isArray(t.crew)&&t.crew.length)?t.crew:DEFAULT_CREW;
  const slots=[];
  crew.forEach(mem=>{
    const prim=mem.member_id;
    slots.push({role:prim,cap:6,bonus:false});
    Object.keys(mem.roles||{}).filter(r=>r!==prim).forEach(r=>slots.push({role:r,cap:3,bonus:true}));
  });
  return {slots, count:crew.length};
}
function loMaps(){
  const t={},e={},c={},s={};
  if(LO_REF){
    (LO_REF.tanks||[]).forEach(x=>t[x.tank_id]=x);
    const em=LO_REF.equipmentMap||{}; Object.keys(em).forEach(k=>e[k]=em[k]);
    (LO_REF.equipment||[]).forEach(f=>(f.grades||[]).forEach(g=>{ if(!e[g.id]) e[g.id]=g; })); // secours si equipmentMap absent
    (LO_REF.consumables||[]).forEach(x=>c[x.id]=x);
    (LO_REF.skills||[]).forEach(x=>s[x.id]={...x, image:'skills/'+x.id+'.png'});   // icone locale (API WG en 404)
  }
  return {t,e,c,s};
}
// Index des familles d'equipements : id -> famille / grade, et grade -> libelle+couleur.
const EQ_GRADE_META={standard:["Standard","#8b9099"],bounty:["Bounty","#e668b3"],improved:["Amélioré","#a874ff"]};
function loEqFam(){ const idFam={},idGr={},fam={}; ((LO_REF&&LO_REF.equipment)||[]).forEach(f=>{ fam[f.key]=f; (f.grades||[]).forEach(g=>{ idFam[g.id]=f.key; idGr[g.id]=g.grade; }); }); return {idFam,idGr,fam}; }
async function loadLoadouts(){
  const list=document.getElementById("loList");
  list.innerHTML='<div class="card">'+cpLoader()+'</div>';
  // 1) Les loadouts (rapide, base) — c'est ce qui remplit l'onglet.
  try{
    const r=await fnCall("loadouts",{session:localStorage.getItem(LS_SESSION),action:"list"});
    if(!r.ok){ list.innerHTML='<div class="card"><div class="empty">Erreur loadouts : '+esc((r.j&&r.j.error)||String(r.status))+' — la fonction « loadouts » est-elle déployée ?</div></div>'; return; }
    LOADOUTS=r.j.loadouts||[]; LO_CANEDIT=meIsManager();
    document.getElementById("loNewBtn").classList.toggle("hidden",!LO_CANEDIT);
    document.getElementById("loRole").textContent = LO_CANEDIT
      ? "Tu peux créer et modifier les loadouts du clan."
      : "Consultation seule — réservé aux officiers de combat et plus.";
    renderLoadouts();
  }catch(e){
    list.innerHTML='<div class="card"><div class="empty">Impossible de joindre la fonction « loadouts » ('+esc(String(e))+'). Vérifie son déploiement.</div></div>';
    return;
  }
  // 2) La référence (chars/équipements/conso : icônes+stats+éditeur) — best-effort, en arrière-plan.
  if(!LO_REF || !(LO_REF.tanks||[]).length){
    try{
      const rf=await fnCall("reference",{session:localStorage.getItem(LS_SESSION)});
      if(rf.ok && rf.j && rf.j.tanks){ LO_REF=rf.j; renderLoadouts(); }
      else document.getElementById("loRole").textContent+=" (⚠️ données chars/équipements indisponibles — fonction « reference » à déployer)";
    }catch(e){ /* on garde l'affichage sans icônes */ }
  }
  // 3) Données des modifications de terrain (pour afficher rôle + modifs sur les cartes).
  if(!LO_FM){ try{ const r=await fetch('fieldmods.json',{cache:'no-cache'}); if(r.ok){ LO_FM=await r.json(); renderLoadouts(); } }catch(e){} }
}
function loIcons(arr){ return arr.length ? arr.map(x=>`<img class="lo-ico" src="${esc(x.image||"")}" title="${esc(x.name||"")}" alt="${esc(x.name||"")}" onerror="this.style.display='none'">`).join("") : '<span class="hint">—</span>'; }
const CLS_COLOR={heavyTank:"#e0894a",mediumTank:"#46c85a",lightTank:"#4f97ee","AT-SPG":"#a970ff",SPG:"#ec6a6a"};
const CLS_FR={heavyTank:"Lourd",mediumTank:"Moyen",lightTank:"Léger","AT-SPG":"Chasseur",SPG:"Artillerie"};
// Rôle du char déduit de son arbre de modifications de terrain (ex role_HT_break -> "Percée").
const FMROLE_FR={break:"Percée",assault:"Assaut",support:"Soutien",universal:"Polyvalent",sniper:"Sniper",wheeled:"Roues",temperatureGun:"Soutien"};
function fmRoleName(tank_id){ if(!LO_FM||!LO_FM.tankTree) return ""; const tk=LO_FM.tankTree[String(tank_id)]; if(!tk) return "";
  if(tk==="role_SPG") return "Artillerie"; return FMROLE_FR[tk.split('_').pop()]||""; }
// Mods de terrain choisis (paires) d'un loadout : mod + niveau + côté (gauche/droite).
function fmCardMods(lo){ if(!LO_FM) return []; const p=(lo.fieldmods&&lo.fieldmods.pairs)||{}, out=[];
  const tree=(LO_FM.trees&&LO_FM.trees[LO_FM.tankTree&&LO_FM.tankTree[String(lo.tank_id)]])||[];
  const lvlOf={}; tree.forEach(n=>{ if(n.kind==='pair') lvlOf[n.ref]=n.lvl; });
  Object.keys(p).forEach(pk=>{ const side=p[pk]; if(side!=='a'&&side!=='b')return; const pr=LO_FM.pairs[pk]; if(!pr)return; const m=LO_FM.mods[pr[side]]; if(m) out.push({m, lvl:lvlOf[pk]||0, side}); });
  out.sort((a,b)=>(a.lvl||0)-(b.lvl||0)); return out; }
function renderLoadouts(){
  const el=document.getElementById("loList"), M=loMaps();
  if(!LOADOUTS.length){
    el.innerHTML=`<div class="lo-empty"><div class="lo-empty-ic">🛠️</div><div class="lo-empty-t">Aucun loadout pour l'instant</div>`
      +(LO_CANEDIT?`<div class="lo-empty-s">Clique « Ajouter un loadout » pour créer le premier réglage recommandé du clan.</div>`:`<div class="lo-empty-s">Les officiers de combat n'ont pas encore renseigné de réglages.</div>`)+`</div>`;
    return;
  }
  const dtiles=(arr,cap)=>arr.length?arr.map(x=>`<div class="lo-dtile" title="${esc(x.name||"")}"><div class="lo-dtile-ic"><img src="${esc(x.image||x.icon||"")}" onerror="this.style.display='none'" loading="lazy"></div>${cap?`<span>${esc(x.name||"")}</span>`:""}</div>`).join(""):'<span class="lo-none">—</span>';
  const prSet=new Set(PR_LIST);
  LOADOUTS.sort((a,b)=>(prSet.has(Number(b.tank_id))-prSet.has(Number(a.tank_id))));
  el.innerHTML='<div class="lo-cards">'+LOADOUTS.map((lo,idx)=>{
    const t=M.t[lo.tank_id]||{name:lo.tank_name||("Char "+lo.tank_id),icon:"",type:""};
    const col=CLS_COLOR[t.type]||"var(--accent)";
    const eq=(lo.equipment||[]).map(id=>M.e[id]).filter(Boolean);
    const co=(lo.consumables||[]).map(id=>M.c[id]).filter(Boolean);
    const sk=loFlatSkills(lo.skills).map(id=>M.s[id]).filter(Boolean);
    const fmd=lo.fieldmods||{};
    const eq2=(fmd.equip2?(fmd.equipment2||[]):[]).map(id=>M.e[id]).filter(Boolean);
    const co2=(fmd.cons2?(fmd.consumables2||[]):[]).map(id=>M.c[id]).filter(Boolean);
    const fmMods=fmCardMods(lo);
    const fmTags=[fmd.equip2?'2ᵉ config équip.':null, fmd.cons2?'2ᵉ config conso.':null].filter(Boolean);
    const role=fmRoleName(lo.tank_id);
    const clsLbl=(CLS_FR[t.type]||"")+(role?(' · '+role):"");
    const pills=[];
    if(t.hp)pills.push(`<span class="lo-pill">${fmt(t.hp)} PV</span>`);
    if(t.view_range)pills.push(`<span class="lo-pill">${t.view_range} m</span>`);
    if(t.speed)pills.push(`<span class="lo-pill">${t.speed} km/h</span>`);
    const btns=LO_CANEDIT?`<div class="lo-cardact"><button class="lo-mini" data-edit="${lo.tank_id}" title="Modifier">✎</button><button class="lo-mini lo-minidel" data-del="${lo.tank_id}" title="Supprimer">✕</button></div>`:"";
    return `<div class="lo-card2 lo-collapsed${prSet.has(Number(lo.tank_id))?" is-prio":""}" style="--cls:${col};animation-delay:${Math.min(idx,12)*55}ms">
      <div class="lo-card2-h">
        ${t.icon?`<div class="lo-t-ic"><img src="${esc(t.icon)}" onerror="this.style.display='none'"></div>`:""}
        <div class="lo-t-info"><div class="lo-t-name">${prSet.has(Number(lo.tank_id))?'<span class="lo-star" title="Char prioritaire du clan">★</span>':''}${esc(t.name)}</div>
          <div class="lo-t-meta">${t.type?`<span class="lo-clsic" style="--cimg:url(classes/${esc(t.type)}.png)"></span>`:""}<span class="lo-cls">${esc(clsLbl)}</span><span class="lo-tier">X</span></div>
          <div class="lo-pills">${pills.join("")}</div>
        </div>${btns}<span class="lo-chev" aria-hidden="true">⌄</span></div>
      <div class="lo-card2-body">
      <div class="lo-sec2"><div class="lo-sec2-l">Équipements${eq2.length?' A':''}</div><div class="lo-dtiles">${dtiles(eq,true)}</div></div>
      ${eq2.length?`<div class="lo-sec2"><div class="lo-sec2-l">Équip. B</div><div class="lo-dtiles">${dtiles(eq2,true)}</div></div>`:""}
      <div class="lo-sec2"><div class="lo-sec2-l">Consommables${co2.length?' A':''}</div><div class="lo-dtiles">${dtiles(co,true)}</div></div>
      ${co2.length?`<div class="lo-sec2"><div class="lo-sec2-l">Conso. B</div><div class="lo-dtiles">${dtiles(co2,true)}</div></div>`:""}
      <div class="lo-sec2"><div class="lo-sec2-l">Compétences</div><div class="lo-dtiles sk">${dtiles(sk,false)}</div></div>
      ${(fmTags.length||fmMods.length)?`<div class="lo-sec2"><div class="lo-sec2-l">Modif. terrain</div><div class="lo-dtiles lo-fmrow">${fmTags.map(x=>`<span class="lo-fmbadge">${x}</span>`).join("")}${fmMods.map(x=>`<div class="lo-dtile lo-fmtile" title="Niveau ${x.lvl} · ${x.side==='a'?'Gauche':'Droite'} — ${esc((x.m.stats||[]).map(s=>s.name).join(', '))}"><div class="lo-dtile-ic">${x.m.img?`<img src="fieldmods/${esc(x.m.img)}.png" onerror="this.style.display='none'">`:""}</div><span class="lo-fmcap">Niv.${x.lvl}<b>${x.side==='a'?'Gauche':'Droite'}</b></span></div>`).join("")}</div></div>`:""}
      ${lo.notes?`<div class="lo-note2">${esc(lo.notes)}</div>`:""}
      <div class="lo-by2">Recommandé par ${esc(lo.created_by_name||"?")}</div>
      </div>
    </div>`;
  }).join("")+'</div>';
  el.querySelectorAll(".lo-card2-h").forEach(h=>h.onclick=e=>{ if(e.target.closest("[data-edit],[data-del]")) return; h.closest(".lo-card2").classList.toggle("lo-collapsed"); });
  el.querySelectorAll("[data-edit]").forEach(b=>b.onclick=e=>{e.stopPropagation();openLoadoutEditor(LOADOUTS.find(x=>String(x.tank_id)===b.dataset.edit));});
  el.querySelectorAll("[data-del]").forEach(b=>b.onclick=e=>{e.stopPropagation();deleteLoadout(b.dataset.del);});
}
const WIZ_STEPS=[["Char","i-grid"],["Équipements","i-tools"],["Consommables","i-heart"],["Équipage","i-users"],["Améliorations","i-bolt"]];
let LO_FM=null;   // donnees des modifications de terrain (web/fieldmods.json)
function fmNorm(f){ f=(f&&typeof f==='object')?f:{}; return { cons2:!!f.cons2, equip2:!!f.equip2, roleSlot:!!f.roleSlot, pairs:(f.pairs&&typeof f.pairs==='object')?f.pairs:{} }; }
async function openLoadoutEditor(lo){
  // charge la reference a la demande si elle n'est pas (encore) prete
  if(!LO_REF || !(LO_REF.tanks||[]).length){
    const btn=document.getElementById("loNewBtn"); const old=btn?btn.textContent:"";
    if(btn){ btn.disabled=true; btn.textContent="Chargement des chars…"; }
    try{
      const rf=await fnCall("reference",{session:localStorage.getItem(LS_SESSION)});
      if(rf.ok && rf.j && (rf.j.tanks||[]).length) LO_REF=rf.j;
    }catch(e){}
    if(btn){ btn.disabled=false; btn.textContent=old; }
    if(!LO_REF || !(LO_REF.tanks||[]).length){
      alert("Impossible de charger la liste des chars/équipements (fonction « reference »). Réessaie dans quelques secondes.");
      return;
    }
  }
  if(!LO_FM){ try{ const r=await fetch('fieldmods.json',{cache:'no-cache'}); if(r.ok) LO_FM=await r.json(); }catch(e){} }
  LO_NEW=!lo;
  const eqp=(lo&&lo.equipment)||[], cop=(lo&&lo.consumables)||[], skp=(lo&&lo.skills);
  const skills={commander:[],gunner:[],driver:[],radioman:[],loader:[]};
  if(skp && !Array.isArray(skp) && typeof skp==='object'){
    CREW_ROLES.forEach(r=>skills[r[0]]=(skp[r[0]]||[]).map(String));
    if(!skills.radioman.length && skp.radio) skills.radioman=skp.radio.map(String);   // ancien nom "radio"
  } else if(Array.isArray(skp)) skills.commander=skp.map(String);
  LO_WIZ={ step:1, tank_id:(lo&&lo.tank_id)||0,
    equipment:(eqp||[]).map(Number).filter(Boolean),
    consumables:(cop||[]).map(Number).filter(Boolean),
    equipment2:(((lo&&lo.fieldmods&&lo.fieldmods.equipment2))||[]).map(Number).filter(Boolean),
    consumables2:(((lo&&lo.fieldmods&&lo.fieldmods.consumables2))||[]).map(Number).filter(Boolean),
    fm:fmNorm(lo&&lo.fieldmods), eqCfg:'a', coCfg:'a',
    skills, notes:(lo&&lo.notes)||"", role:'commander',
    tq:"", tcls:"", tnat:"", eq:"", cq:"", sq:"" };
  const ed=document.getElementById("loEditor"); ed.classList.remove("hidden");
  renderWizard();
  ed.scrollIntoView({behavior:"smooth",block:"start"});
}
function renderWizard(){
  const W=LO_WIZ, ed=document.getElementById("loEditor");
  const _ft=ed.querySelector('.fm-tree'); const savedScroll=_ft?_ft.scrollTop:0;   // conserve le défilement de l'arbre
  const steps=WIZ_STEPS.map((s,i)=>{ const n=i+1, done=n<W.step, cur=n===W.step, clk=(n===1||W.tank_id);
    return `<button type="button" class="wz-step${cur?' cur':''}${done?' done':''}${clk?'':' lock'}" data-step="${n}">
      <span class="wz-num">${done?'✓':n}</span><span class="wz-lbl">${s[0]}</span></button>`
    +(n<5?'<span class="wz-line'+(done?' on':'')+'"></span>':''); }).join("");
  const main = W.step===1?wizStep1() : W.step===2?wizStepEquip() : W.step===3?wizStepItems('co') : W.step===4?wizStep4() : wizStep5();
  const prev = W.step>1 ? `<button class="wz-btn" id="wizPrev">← Précédent</button>` : `<span></span>`;
  const next = W.step<5
    ? `<button class="wz-btn wz-go" id="wizNext">Continuer →</button>`
    : `<button class="wz-btn wz-save" id="wizSave">✓ Enregistrer le loadout</button>`;
  ed.innerHTML=`<div class="card lo-wiz dashx">
    <div class="wz-head"><div class="wz-htitle">${LO_NEW?"Nouveau loadout":"Modifier le loadout"}</div>
      <button class="wz-close" id="wizCancel">✕ Annuler</button></div>
    <div class="wz-steps">${steps}</div>
    <div class="wz-body"><div class="wz-main">${main}</div>${wizSide()}</div>
    <div class="wz-nav">${prev}${next}</div></div>`;
  wizWire();
  const ft=ed.querySelector('.fm-tree'); if(ft && savedScroll) ft.scrollTop=savedScroll;
}
function wizWire(){
  const W=LO_WIZ, ed=document.getElementById("loEditor");
  document.getElementById("wizCancel").onclick=()=>{ ed.classList.add("hidden"); ed.innerHTML=""; LO_WIZ=null; };
  ed.querySelectorAll(".wz-step:not(.lock)").forEach(s=> s.onclick=()=>{ const n=Number(s.dataset.step); if(n===1||W.tank_id){ W.step=n; renderWizard(); } });
  const prev=document.getElementById("wizPrev"); if(prev) prev.onclick=()=>{ W.step=Math.max(1,W.step-1); renderWizard(); };
  const next=document.getElementById("wizNext"); if(next) next.onclick=()=>{ if(W.step===1&&!W.tank_id){ alert("Choisis d’abord un char."); return; } W.step=Math.min(5,W.step+1); renderWizard(); };
  const save=document.getElementById("wizSave"); if(save) save.onclick=saveLoadout;
  if(W.step===1) wizWire1();
  else if(W.step===2) wizWireEquip();
  else if(W.step===3) wizWireItems('co');
  else if(W.step===4) wizWire4();
  else if(W.step===5) wizWire5();
}
const LO_CLS_OPT=[["heavyTank","Lourds"],["mediumTank","Moyens"],["lightTank","Légers"],["AT-SPG","Chasseurs"],["SPG","Artillerie"]];
const LO_NATION_FR={ussr:"URSS",germany:"Allemagne",usa:"USA",france:"France",uk:"Royaume-Uni",china:"Chine",japan:"Japon",czech:"Tchéquie",sweden:"Suède",poland:"Pologne",italy:"Italie"};

/* ---- Étape 1 : choix du char (chars déjà réglés grisés) ---- */
function wizStep1(){
  const src=(LO_REF.tanks||[]), W=LO_WIZ;
  const used=new Set(LOADOUTS.map(l=>Number(l.tank_id)));
  const nats=[...new Set(src.map(x=>x.nation).filter(Boolean))].sort();
  const natOpts='<option value="">Toutes nations</option>'+nats.map(n=>`<option value="${n}"${W.tnat===n?' selected':''}>${LO_NATION_FR[n]||n}</option>`).join("");
  const clsOpts='<option value="">Toutes classes</option>'+LO_CLS_OPT.filter(c=>src.some(x=>x.type===c[0])).map(c=>`<option value="${c[0]}"${W.tcls===c[0]?' selected':''}>${c[1]}</option>`).join("");
  const grid=src.map(x=>{
    const id=Number(x.tank_id), dis=used.has(id)&&id!==Number(W.tank_id), sel=id===Number(W.tank_id);
    return `<button type="button" class="lo-popt lo-popt-char${sel?' sel':''}${dis?' dis':''}" ${dis?'disabled':''} data-tank="${id}" data-cls="${esc(x.type||'')}" data-nat="${esc(x.nation||'')}" data-name="${esc(String(x.name).toLowerCase())}">
      <img src="${esc(x.icon||'')}" onerror="this.style.display='none'" loading="lazy">
      <span>${esc(x.name)}</span>${dis?'<em class="lo-used">déjà réglé</em>':(sel?'<em class="lo-ok">✓ choisi</em>':'')}</button>`;
  }).join("");
  return `<div class="wz-hdr"><h3>Choix du char</h3><p>Sélectionne le char tier X à configurer. Les chars déjà réglés sont grisés.</p></div>
    <div class="wz-flt"><span class="wz-tier">Tier X</span>
      <select class="lo-fclass" id="wizTCls">${clsOpts}</select>
      <select class="lo-fnation" id="wizTNat">${natOpts}</select>
      <input class="lo-search" id="wizTQ" placeholder="Rechercher un char…" value="${esc(W.tq||'')}"></div>
    <div class="lo-grid lo-grid-char wz-grid">${grid}</div>`;
}
function wizWire1(){
  const W=LO_WIZ, ed=document.getElementById("loEditor");
  const q=document.getElementById("wizTQ"), fc=document.getElementById("wizTCls"), fn=document.getElementById("wizTNat");
  const apply=()=>{ W.tq=q.value; W.tcls=fc.value; W.tnat=fn.value; const qq=(W.tq||'').toLowerCase();
    ed.querySelectorAll(".lo-popt-char").forEach(b=>{ const ok=(!qq||b.dataset.name.indexOf(qq)>=0)&&(!W.tcls||b.dataset.cls===W.tcls)&&(!W.tnat||b.dataset.nat===W.tnat); b.style.display=ok?'':'none'; }); };
  q.oninput=apply; fc.onchange=apply; fn.onchange=apply; apply();
  ed.querySelectorAll(".lo-popt-char:not(.dis)").forEach(b=> b.onclick=()=>{
    const nid=Number(b.dataset.tank);
    if(nid!==Number(W.tank_id)){   // char différent -> on réinitialise les étapes suivantes (spécifiques au char)
      W.equipment=[]; W.consumables=[]; W.equipment2=[]; W.consumables2=[];
      W.skills={commander:[],gunner:[],driver:[],radioman:[],loader:[]};
      W.fm={cons2:false,equip2:false,roleSlot:false,pairs:{}};
      W.eqCfg='a'; W.coCfg='a'; W.role='commander';
    }
    W.tank_id=nid; W.step=2; renderWizard();
  });
}

/* ---- Étapes 2 & 3 : équipements / consommables (3 max) ---- */
function wizStepItems(cat){
  const W=LO_WIZ, isEq=cat==='eq', M=loMaps(), tnat=(M.t[W.tank_id]||{}).nation||'';
  // consommables : on n'affiche la ration "nourriture" que pour la nation du char.
  const src=isEq?(LO_REF.equipment||[]):((LO_REF.consumables||[]).filter(x=>!x.nation||x.nation===tnat));
  const sel=isEq?W.equipment:wizCoSel(), qv=isEq?(W.eq||''):(W.cq||'');
  const grid=src.map(x=>{ const id=Number(x.id), on=sel.indexOf(id)>=0;
    return `<button type="button" class="lo-item${on?' sel':''}" data-id="${id}" data-name="${esc(String(x.name).toLowerCase())}">
      <img src="${esc(x.image||'')}" onerror="this.style.display='none'" loading="lazy">
      <span>${esc(x.name)}</span><i class="lo-check">✓</i></button>`; }).join("");
  const title=isEq?'Équipements':'Consommables';
  const cfgNote=(!isEq && W.fm.cons2)?` — <b>Config ${W.coCfg==='a'?'A':'B'}</b>`:'';
  return `<div class="wz-hdr"><h3>${title}${cfgNote}</h3><p>Choisis jusqu’à 3 ${isEq?'équipements':'consommables'} recommandés. <b class="wz-cnt" id="wizCnt">${sel.length} / 3</b></p></div>
    ${isEq?'':wizCfgBar('co')}
    <div class="wz-flt"><input class="lo-search" id="wizIQ" placeholder="Rechercher…" value="${esc(qv)}"></div>
    <div class="lo-grid wz-grid wz-igrid">${grid}</div>`;
}
function wizWireItems(cat){
  const W=LO_WIZ, ed=document.getElementById("loEditor"), iq=document.getElementById("wizIQ");
  const apply=()=>{ const v=iq.value.toLowerCase(); if(cat==='eq')W.eq=iq.value; else W.cq=iq.value;
    ed.querySelectorAll(".lo-item").forEach(b=>{ b.style.display=(!v||b.dataset.name.indexOf(v)>=0)?'':'none'; }); };
  iq.oninput=apply; apply();
  ed.querySelectorAll(".lo-item").forEach(b=> b.onclick=()=>wizToggleItem(cat,Number(b.dataset.id),b));
  if(cat==='co') wizWireCfg('co');
}
function wizToggleItem(cat,id,btn){
  const W=LO_WIZ, sel=cat==='eq'?W.equipment:wizCoSel(), i=sel.indexOf(id);
  if(i>=0) sel.splice(i,1);
  else { if(sel.length>=3){ wizFlashCnt(); return; } sel.push(id); }
  btn.classList.toggle('sel', sel.indexOf(id)>=0);
  const cnt=document.getElementById("wizCnt"); if(cnt) cnt.textContent=sel.length+' / 3';
  wizRefreshSide();
}
function wizFlashCnt(){ const c=document.getElementById("wizCnt"); if(!c) return; c.classList.add("over"); setTimeout(()=>c.classList.remove("over"),500); }
// 2e configuration (modif. de terrain) : accès à la config active + activation/désactivation.
function wizEqSel(){ const W=LO_WIZ; return (W.fm.equip2 && W.eqCfg==='b') ? W.equipment2 : W.equipment; }
function wizCoSel(){ const W=LO_WIZ; return (W.fm.cons2 && W.coCfg==='b') ? W.consumables2 : W.consumables; }
function wizSetEquip2(on){ const W=LO_WIZ; W.fm.equip2=on; if(on) W.fm.cons2=true; else W.eqCfg='a'; renderWizard(); }   // 2e équip (niv.3) requiert 2e conso (niv.1)
function wizSetCons2(on){ const W=LO_WIZ; W.fm.cons2=on; if(!on){ W.fm.equip2=false; W.coCfg='a'; W.eqCfg='a'; } renderWizard(); }
function wizCfgBar(kind){ const W=LO_WIZ, on=kind==='eq'?W.fm.equip2:W.fm.cons2, cfg=kind==='eq'?W.eqCfg:W.coCfg, what=kind==='eq'?'équipement':'consommables';
  if(!on) return `<button class="wz-cfg-add" id="wizCfgAdd">＋ Activer une 2ᵉ configuration de ${what} (modif. de terrain)</button>`;
  return `<div class="wz-cfg"><span class="wz-cfg-l">Configuration&nbsp;:</span>
    <button class="wz-cfgb${cfg==='a'?' cur':''}" data-cfg="a">A</button>
    <button class="wz-cfgb${cfg==='b'?' cur':''}" data-cfg="b">B</button>
    <button class="wz-cfg-off" id="wizCfgOff">Retirer la 2ᵉ config</button></div>`;
}
function wizWireCfg(kind){ const ed=document.getElementById("loEditor"), W=LO_WIZ;
  const add=document.getElementById("wizCfgAdd"); if(add) add.onclick=()=> kind==='eq'?wizSetEquip2(true):wizSetCons2(true);
  const off=document.getElementById("wizCfgOff"); if(off) off.onclick=()=> kind==='eq'?wizSetEquip2(false):wizSetCons2(false);
  ed.querySelectorAll(".wz-cfgb").forEach(b=> b.onclick=()=>{ if(kind==='eq')W.eqCfg=b.dataset.cfg; else W.coCfg=b.dataset.cfg; renderWizard(); });
}

/* ---- Étape 2 : équipements par FAMILLE (clic -> choix du grade Standard/Bounty/Amélioré) ---- */
function wizStepEquip(){
  const W=LO_WIZ, fams=(LO_REF.equipment||[]), idx=loEqFam(), sel=wizEqSel();
  const grid=fams.map(f=>{
    const selId=sel.find(id=>idx.idFam[id]===f.key);
    const g=selId?idx.idGr[selId]:null, col=g?EQ_GRADE_META[g][1]:'';
    const dots=(f.grades||[]).map(gr=>`<i class="lo-gdot${g===gr.grade?' on':''}" style="--d:${EQ_GRADE_META[gr.grade][1]}"></i>`).join("");
    return `<button type="button" class="lo-item lo-eqfam${selId?' sel':''}" data-key="${esc(f.key)}" data-name="${esc(String(f.name).toLowerCase())}"${selId?` style="--gcol:${col}"`:''}>
      <img src="${esc(f.icon||'')}" onerror="this.style.display='none'" loading="lazy">
      <span>${esc(f.name)}</span><div class="lo-gdots">${dots}</div><i class="lo-check">✓</i></button>`;
  }).join("");
  const cfgNote = W.fm.equip2?` — <b>Config ${W.eqCfg==='a'?'A':'B'}</b>`:'';
  return `<div class="wz-hdr"><h3>Équipements${cfgNote}</h3><p>Choisis jusqu’à 3 équipements. Clique un équipement pour choisir son grade : <b style="color:#8b9099">Standard</b> · <b style="color:#e668b3">Bounty</b> · <b style="color:#a874ff">Amélioré</b>. <b class="wz-cnt" id="wizCnt">${sel.length} / 3</b></p></div>
    ${wizCfgBar('eq')}
    <div class="wz-flt"><input class="lo-search" id="wizIQ" placeholder="Rechercher un équipement…" value="${esc(W.eq||'')}"></div>
    <div class="lo-grid wz-grid wz-igrid">${grid}</div>
    <div class="wz-gpick hidden" id="wizGpick"></div>`;
}
function wizWireEquip(){
  const W=LO_WIZ, ed=document.getElementById("loEditor"), iq=document.getElementById("wizIQ");
  const apply=()=>{ W.eq=iq.value; const v=iq.value.toLowerCase(); ed.querySelectorAll(".lo-eqfam").forEach(b=>{ b.style.display=(!v||b.dataset.name.indexOf(v)>=0)?'':'none'; }); };
  iq.oninput=apply; apply();
  ed.querySelectorAll(".lo-eqfam").forEach(b=> b.onclick=()=>wizOpenGrade(b.dataset.key));
  wizWireCfg('eq');
}
function wizOpenGrade(key){
  const W=LO_WIZ, idx=loEqFam(), f=idx.fam[key]; if(!f) return;
  const selId=wizEqSel().find(id=>idx.idFam[id]===key);
  const cards=(f.grades||[]).map(g=>{ const meta=EQ_GRADE_META[g.grade], on=selId===g.id;
    return `<button type="button" class="lo-gcard grade-${g.grade}${on?' on':''}" data-id="${g.id}" style="--gcol:${meta[1]}">
      <div class="lo-gcard-ic"><img src="${esc(g.image||'')}" onerror="this.style.display='none'"></div>
      <div class="lo-gtag">${meta[0]}</div><div class="lo-gname">${esc(g.name)}</div>
      ${on?'<div class="lo-gon">✓ sélectionné</div>':''}</button>`; }).join("");
  const box=document.getElementById("wizGpick"); box.className="wz-gpick";
  box.innerHTML=`<div class="wz-gpick-bx">
    <div class="wz-gpick-h"><b>${esc(f.name)}</b><span>Choisis le grade</span><button class="wz-gpick-x" id="wizGx">✕</button></div>
    <div class="lo-gcards">${cards}</div>
    ${selId?'<button class="wz-gremove" id="wizGrm">Retirer cet équipement</button>':''}</div>`;
  box.onclick=(e)=>{ if(e.target===box) wizCloseGrade(); };
  box.querySelector("#wizGx").onclick=wizCloseGrade;
  box.querySelectorAll(".lo-gcard").forEach(b=> b.onclick=()=>wizPickGrade(key,Number(b.dataset.id)));
  const rm=box.querySelector("#wizGrm"); if(rm) rm.onclick=()=>wizPickGrade(key,null);
}
function wizCloseGrade(){ const b=document.getElementById("wizGpick"); if(b){ b.className="wz-gpick hidden"; b.innerHTML=""; } }
function wizPickGrade(key,id){
  const W=LO_WIZ, idx=loEqFam(), arr=wizEqSel(), had=arr.some(x=>idx.idFam[x]===key);
  const out=arr.filter(x=>idx.idFam[x]!==key);
  if(id!==null){
    if(out.length>=3 && !had){ wizCloseGrade(); wizFlashCnt(); return; }
    out.push(id);
  }
  if(W.fm.equip2 && W.eqCfg==='b') W.equipment2=out; else W.equipment=out;
  wizCloseGrade(); renderWizard();
}

/* ---- Étape 4 : compétences par membre d'équipage (réel selon le char) ---- */
function wizCurCap(){ const cs=wizCrewSlots().slots, s=cs.find(x=>x.role===LO_WIZ.role); return s?s.cap:6; }
function wizStep4(){
  const W=LO_WIZ, src=(LO_REF.skills||[]), cw=wizCrewSlots(), slots=cw.slots;
  if(!slots.some(s=>s.role===W.role)) W.role=slots[0]?slots[0].role:'commander';
  const cur=slots.find(s=>s.role===W.role)||{role:W.role,cap:6,bonus:false};
  const sel=W.skills[W.role]||[];
  const tabs=slots.map(s=>{ const n=(W.skills[s.role]||[]).length;
    return `<button type="button" class="wz-rtab${s.role===W.role?' cur':''}${s.bonus?' bonus':''}" data-role="${s.role}">${CREW_FR[s.role]||s.role}${s.bonus?' <em>bonus</em>':''}<span class="wz-rn">${n}</span></button>`; }).join("");
  // pool = perks du rôle courant + perks universels (dispo pour tous)
  const pool=src.filter(x=> x.role===W.role || (x.role==='universal' && !(cur.bonus && BONUS_HIDE.has(String(x.id)))));
  const grid=pool.map(x=>{ const id=String(x.id), on=sel.indexOf(id)>=0;
    return `<button type="button" class="lo-item lo-skill${on?' sel':''}${x.role==='universal'?' univ':''}" data-id="${esc(id)}" data-name="${esc(String(x.name).toLowerCase())}">
      <img src="skills/${esc(id)}.png" onerror="this.style.display='none'" loading="lazy">
      <span>${esc(x.name)}</span><i class="lo-check">✓</i></button>`; }).join("");
  const capNote = cur.bonus ? `Qualification supplémentaire du char (moins d’équipage) : <b>3 perks bonus</b>.` : `Membre principal : <b>6 perks</b> max.`;
  return `<div class="wz-hdr"><h3>Compétences d’équipage</h3><p><b>${cw.count} membres</b> d’équipage. ${capNote} <b class="wz-cnt" id="wizCnt">${sel.length} / ${cur.cap}</b></p></div>
    <div class="wz-rtabs">${tabs}</div>
    <div class="wz-flt"><input class="lo-search" id="wizIQ" placeholder="Rechercher une compétence…" value="${esc(W.sq||'')}"></div>
    <div class="lo-grid wz-grid wz-sgrid">${grid}</div>
    <label class="wz-notes">Notes (optionnel)<textarea id="wizNotes" maxlength="600" rows="2" placeholder="Pourquoi ces choix, quand l’utiliser…">${esc(W.notes||'')}</textarea></label>`;
}
function wizWire4(){
  const W=LO_WIZ, ed=document.getElementById("loEditor"), iq=document.getElementById("wizIQ");
  ed.querySelectorAll(".wz-rtab").forEach(b=> b.onclick=()=>{ W.role=b.dataset.role; renderWizard(); });
  const apply=()=>{ W.sq=iq.value; const v=iq.value.toLowerCase(); ed.querySelectorAll(".lo-skill").forEach(b=>{ b.style.display=(!v||b.dataset.name.indexOf(v)>=0)?'':'none'; }); };
  iq.oninput=apply; apply();
  ed.querySelectorAll(".lo-skill").forEach(b=> b.onclick=()=>wizToggleSkill(String(b.dataset.id),b));
  const nt=document.getElementById("wizNotes"); if(nt) nt.oninput=()=>{ W.notes=nt.value; };
}
function wizToggleSkill(id,btn){
  const W=LO_WIZ, sel=W.skills[W.role], cap=wizCurCap(), i=sel.indexOf(id);
  if(i>=0) sel.splice(i,1);
  else { if(sel.length>=cap){ wizFlashCnt(); return; } sel.push(id); }
  btn.classList.toggle('sel', sel.indexOf(id)>=0);
  const cnt=document.getElementById("wizCnt"); if(cnt) cnt.textContent=sel.length+' / '+cap;
  const tab=document.querySelector('.wz-rtab[data-role="'+W.role+'"] .wz-rn'); if(tab) tab.textContent=sel.length;
  wizRefreshSide();
}

/* ---- Étape 5 : modifications de terrain (améliorations) ---- */
const FM_FEAT={
  shells_consumables_switch:{fr:"2ᵉ emplacement de consommables",flag:"cons2",img:"shellsConsumablesSwitch"},
  opt_dev_boosters_switch:{fr:"2ᵉ emplacement d’équipement",flag:"equip2",img:"optDevBoostersSwitch"}
  // roleSlot volontairement retiré : pas d'"équipement bonus" (précision du clan).
};
const FM_STAT_FR={Strength:"PV",EnginePower:"moteur",AllGroundRotationSpeed:"rotation",CircularVisionRadius:"vue",
  ChassisStrength:"PV chenilles",GunShotDispersionChassisMovement:"disp. en mvt",GunShotDispersionChassisRotation:"disp. rotation",
  GunShotDispersionAfterShot:"disp. après tir",GunShotDispersionGunDamaged:"disp. canon endommagé",TurretRotationSpeed:"rotation tourelle",
  ForwardMaxSpeed:"vitesse av.",FireStartingChance:"risque incendie",AmmoBayStrength:"PV soutes",Camouflage:"camouflage",
  ReloadTime:"rechargement",AimingTime:"visée",DamageReduction:"réduction dégâts"};
function fmTankTree(){ if(!LO_FM||!LO_FM.tankTree) return null; const k=LO_FM.tankTree[String(LO_WIZ.tank_id)]; return k?LO_FM.trees[k]:null; }
function fmFmt(s){ const nm=FM_STAT_FR[s.name]||s.name; if(s.op==='mul'){ const pct=Math.round((s.val-1)*1000)/10; return (pct>=0?'+':'')+pct+'% '+nm; } return (s.val>=0?'+':'')+s.val+' '+nm; }
function fmModStats(m){ if(!m) return ''; return (m.stats||[]).filter(s=>s.name).map(fmFmt).join(' · '); }
function fmStatList(m){ if(!m) return ''; const st=(m.stats||[]).filter(s=>s.name); if(!st.length) return ''; return st.map(s=>`<span class="fm-st">${fmFmt(s)}</span>`).join(''); }
function wizStep5(){
  const W=LO_WIZ, tree=fmTankTree(), t=loMaps().t[W.tank_id]||{};
  if(!LO_FM||!tree) return `<div class="wz-hdr"><h3>Modifications de terrain</h3><p class="wz-mut">Aucune donnée d’amélioration pour ce char (fichier fieldmods.json manquant ou char non répertorié).</p></div>
    <label class="wz-notes">Notes (optionnel)<textarea id="wizNotes" maxlength="600" rows="2">${esc(W.notes||'')}</textarea></label>`;
  const byLvl={}; tree.forEach(n=>{ if(n.kind==='feature'&&n.ref==='roleSlot') return; (byLvl[n.lvl]=byLvl[n.lvl]||[]).push(n); });
  const rows=Object.keys(byLvl).map(Number).sort((a,b)=>a-b).map(lvl=>{
    const nodes=byLvl[lvl]; if(!nodes.length) return ''; const feat=nodes.find(n=>n.kind==='feature');
    if(feat){ const meta=FM_FEAT[feat.ref], on=!!W.fm[meta.flag];
      return `<div class="fm-lvl"><div class="fm-lvl-n">${lvl}</div><div class="fm-lvl-b">
        <button type="button" class="fm-fcard${on?' on':''}" data-feat="${feat.ref}">
          <img src="fieldmods/${meta.img}.png" onerror="this.style.display='none'">
          <div class="fm-fc-t">${meta.fr}</div><i class="fm-chk">${on?'✓':'+'}</i></button></div></div>`;
    }
    const base=nodes.find(n=>n.kind==='mod'), pair=nodes.find(n=>n.kind==='pair');
    let inner='';
    if(base){ const bl=fmStatList(LO_FM.mods[base.ref]); inner+=`<div class="fm-base"><span class="fm-b-tag">Inclus</span><div class="fm-base-st">${bl||'amélioration de base'}</div></div>`; }
    if(pair){ const p=LO_FM.pairs[pair.ref], cur=W.fm.pairs[pair.ref];
      inner+=`<div class="fm-pair">`+['a','b'].map(side=>{ const m=LO_FM.mods[p[side]], on=cur===side;
        return `<button type="button" class="fm-opt${on?' on':''}" data-pair="${esc(pair.ref)}" data-side="${side}">
          <div class="fm-opt-ic">${m&&m.img?`<img src="fieldmods/${esc(m.img)}.png" onerror="this.closest('.fm-opt-ic').classList.add('noimg')">`:'<span class="fm-opt-ph">◈</span>'}</div>
          <div class="fm-opt-st">${fmStatList(m)||'<span class="fm-st">—</span>'}</div><i class="fm-chk">${on?'✓':''}</i></button>`; }).join('')+`</div>`;
    }
    return `<div class="fm-lvl"><div class="fm-lvl-n">${lvl}</div><div class="fm-lvl-b">${inner}</div></div>`;
  }).join("");
  return `<div class="wz-hdr"><h3>Modifications de terrain</h3><p>Améliorations recommandées pour le <b>${esc(t.name||'')}</b>. Certains niveaux débloquent une 2ᵉ configuration (liée aux étapes Équipements/Consommables).</p></div>
    <div class="fm-tree">${rows}</div>
    <label class="wz-notes">Notes (optionnel)<textarea id="wizNotes" maxlength="600" rows="2" placeholder="Pourquoi ces choix, quand l’utiliser…">${esc(W.notes||'')}</textarea></label>`;
}
function wizWire5(){
  const ed=document.getElementById("loEditor"), W=LO_WIZ;
  ed.querySelectorAll(".fm-fcard").forEach(b=> b.onclick=()=>{ const meta=FM_FEAT[b.dataset.feat], cur=!!W.fm[meta.flag];
    if(meta.flag==='equip2') wizSetEquip2(!cur);
    else if(meta.flag==='cons2') wizSetCons2(!cur);
    else { W.fm.roleSlot=!cur; renderWizard(); } });
  ed.querySelectorAll(".fm-opt").forEach(b=> b.onclick=()=>{ const pk=b.dataset.pair, side=b.dataset.side;
    const nv=(W.fm.pairs[pk]===side)?null:side; W.fm.pairs[pk]=nv;   // mise à jour sur place (pas de re-render -> pas de saut de défilement)
    b.closest('.fm-pair').querySelectorAll('.fm-opt').forEach(o=>{ const on=(o.dataset.side===nv); o.classList.toggle('on',on); const c=o.querySelector('.fm-chk'); if(c) c.textContent=on?'✓':''; });
    wizRefreshSide(); });
  const nt=document.getElementById("wizNotes"); if(nt) nt.oninput=()=>{ W.notes=nt.value; };
}

/* ---- Panneau résumé (droite, persistant) ---- */
function wizSide(){ return `<aside class="wz-side" id="wizSide">${wizSideInner()}</aside>`; }
function wizSideInner(){
  const M=loMaps(), W=LO_WIZ, t=W.tank_id?M.t[W.tank_id]:null;
  const chip=(it)=>`<div class="wz-chip" title="${esc(it.name||'')}"><img src="${esc(it.image||it.icon||'')}" onerror="this.style.display='none'"><span>${esc(it.name||'')}</span></div>`;
  const idx=loEqFam();
  const eqRow=W.equipment.map(id=>{ const it=M.e[id]; if(!it)return''; const g=idx.idGr[id], col=g?EQ_GRADE_META[g][1]:'';
    return `<div class="wz-chip" title="${esc(it.name||'')}"${col?` style="--gcol:${col}"`:''}><img src="${esc(it.image||it.icon||'')}" onerror="this.style.display='none'"><span>${esc(it.name||'')}</span></div>`; }).join("")||'<span class="wz-mut">—</span>';
  const coRow=W.consumables.map(id=>M.c[id]).filter(Boolean).map(chip).join("")||'<span class="wz-mut">—</span>';
  const skRows=wizCrewSlots().slots.map(s=>{ const n=(W.skills[s.role]||[]).length;
    return `<div class="wz-skln"><span>${CREW_FR[s.role]||s.role}${s.bonus?' <em class="wz-b">bonus</em>':''}</span><div class="wz-bar"><i style="width:${Math.round(n/s.cap*100)}%"></i></div><b>${n}/${s.cap}</b></div>`; }).join("");
  return `<div class="wz-side-h">Résumé</div>
    <div class="wz-tk">${t?`<img src="${esc(t.icon||'')}" onerror="this.style.display='none'"><div class="wz-tk-n">${esc(t.name)}</div><div class="wz-tk-m">${esc(CLS_FR[t.type]||'')} · Tier X</div>`:'<div class="wz-mut">Aucun char sélectionné</div>'}</div>
    <div class="wz-sblk"><div class="wz-sblk-h">Équipements</div><div class="wz-chips">${eqRow}</div></div>
    <div class="wz-sblk"><div class="wz-sblk-h">Consommables</div><div class="wz-chips">${coRow}</div></div>
    <div class="wz-sblk"><div class="wz-sblk-h">Compétences</div>${skRows}</div>
    <div class="wz-sblk"><div class="wz-sblk-h">Améliorations</div><div class="wz-fmsum">${
      [W.fm.equip2?'2ᵉ empl. équip.':null, W.fm.cons2?'2ᵉ empl. conso.':null,
       Object.values(W.fm.pairs||{}).filter(Boolean).length?Object.values(W.fm.pairs).filter(Boolean).length+' modif.':null
      ].filter(Boolean).map(x=>`<span class="wz-fmtag">${x}</span>`).join('')||'<span class="wz-mut">—</span>'}</div></div>`;
}
function wizRefreshSide(){ const s=document.getElementById("wizSide"); if(s) s.innerHTML=wizSideInner(); }

async function saveLoadout(){
  const W=LO_WIZ;
  if(!W.tank_id){ alert("Choisis un char."); return; }
  const t=loMaps().t[W.tank_id]||{};
  const payload={ tank_id:Number(W.tank_id), tank_name:t.name||"",
    equipment:W.equipment.filter(Boolean), consumables:W.consumables.filter(Boolean),
    skills:{ commander:W.skills.commander, gunner:W.skills.gunner, driver:W.skills.driver, radioman:W.skills.radioman, loader:W.skills.loader },
    notes:(W.notes||"").trim(),
    fieldmods:{ cons2:!!W.fm.cons2, equip2:!!W.fm.equip2, roleSlot:!!W.fm.roleSlot, pairs:W.fm.pairs||{},
      equipment2:W.fm.equip2?W.equipment2.filter(Boolean):[], consumables2:W.fm.cons2?W.consumables2.filter(Boolean):[] } };
  const btn=document.getElementById("wizSave"); if(btn){ btn.disabled=true; btn.textContent="Enregistrement…"; }
  const r=await fnCall("loadouts",{session:localStorage.getItem(LS_SESSION),action:"save",loadout:payload});
  if(!r.ok){ if(btn){ btn.disabled=false; btn.textContent="✓ Enregistrer le loadout"; } alert("Erreur : "+(r.j.error||r.status)); return; }
  const ed=document.getElementById("loEditor"); ed.classList.add("hidden"); ed.innerHTML=""; LO_WIZ=null;
  loadLoadouts();
}
async function deleteLoadout(tid){
  if(!confirm("Supprimer ce loadout ?")) return;
  const r=await fnCall("loadouts",{session:localStorage.getItem(LS_SESSION),action:"delete",tank_id:Number(tid)});
  if(!r.ok){ alert("Erreur : "+(r.j.error||r.status)); return; }
  loadLoadouts();
}

/* ============================================================
   TIER LISTS (style TierMaker) — glisse-dépose des chars par tier
   ============================================================ */
let TIERLISTS=[], TL_CANEDIT=false, TL_EDIT=null, TL_DRAG=null, TL_LOADED=false, TL_TQ="", TL_TCLS="", TL_TNAT="";
const TL_DEFAULT_ROWS=()=>[
  {label:"S",color:"#e5544b",tanks:[]},{label:"A",color:"#e59a4b",tanks:[]},
  {label:"B",color:"#e5c84b",tanks:[]},{label:"C",color:"#8fd14f",tanks:[]},{label:"D",color:"#5bb0e5",tanks:[]}];
/* ============================================================
   TIER X PRIORITAIRE
     PR_LIST  : les chars retenus par le clan   -> stocké au niveau du CLAN
     violet   : déduit de l'API, non éditable   -> voir prIsOpt()
     PR_OWNED : ce que CE joueur possède déjà   -> stocké par ACCOUNT_ID
   ============================================================ */
let PR_LIST=[], PR_OWNED=new Set(), PR_CANEDIT=false, PR_LOADED=false, PR_DRAFT=null, PR_Q="";
// L'API WG renvoie des espaces INSÉCABLES dans les noms (« Object 452K »).
const prNrm = s => String(s||"").replace(/ /g," ").trim();
// Statuts déduits de la fonction « reference » : premium (is_premium) / collection (pas de prices_xp) / arbre techno.
const prIsPrem = t => !!t.is_premium || !t.prices_xp;
const prIsOpt  = t => !!t.is_premium;
const prStatut = t => t.is_premium ? "Char premium" : (!t.prices_xp ? "Char de collection" : null);
const PR_COLS=[["heavyTank","Chars lourds"],["mediumTank","Chars moyens"],
               ["lightTank","Chars légers"],["AT-SPG","Chars snipers"]];
const prTanks = () => ((LO_REF&&LO_REF.tanks)||[]).filter(t=>!t.tier||Number(t.tier)===10);
const prIcon  = t => t.small_icon || t.icon || "";
const prGem   = t => prIsPrem(t)
  ? `<svg class="pr-prem-ic" aria-label="${esc(prStatut(t)||"")}"><use href="#i-prem"/></svg>` : "";
async function loadPrio(){
  PR_LOADED=true;
  const el=document.getElementById("prPanel"); el.innerHTML='<div class="card">'+cpLoader()+'</div>';
  if(!LO_REF || !(LO_REF.tanks||[]).length){
    try{ const rf=await fnCall("reference",{session:localStorage.getItem(LS_SESSION)});
         if(rf.ok&&rf.j&&rf.j.tanks) LO_REF=rf.j; }catch(e){}
  }
  try{
    const r=await fnCall("loadouts",{session:localStorage.getItem(LS_SESSION),action:"prio_get"});
    if(!r.ok){ el.innerHTML='<div class="empty">Erreur : '+esc((r.j&&r.j.error)||String(r.status))
      +' — l\'action « prio_get » est-elle déployée ?</div>'; return; }
    PR_LIST=(r.j.prio||[]).map(Number);
    PR_OWNED=new Set((r.j.owned||[]).map(Number));
    PR_CANEDIT=meIsManager();
    prRenderAll();
  }catch(e){ el.innerHTML='<div class="empty">Impossible de joindre « loadouts » ('+esc(String(e))+').</div>'; }
}
function prRenderAll(){
  document.getElementById("prEditBtn").classList.toggle("hidden", !PR_CANEDIT);
  document.getElementById("prRole").textContent = PR_CANEDIT
    ? "Tu peux composer la liste des chars prioritaires du clan."
    : "Consultation seule — seuls les officiers de combat et plus composent la liste. Tu peux cocher les chars que tu possèdes.";
  prRenderPanel(); prRenderProg(); renderLoadouts();   // renderLoadouts : remonte les ★
}
function prRenderPanel(){
  const panel=document.getElementById("prPanel");
  if(!PR_LIST.length){
    panel.innerHTML=`<div class="pr-empty"><div class="pr-empty-ic">★</div>
      <div class="pr-empty-t">Aucun char dans la liste</div>
      <div class="lu-sub">${PR_CANEDIT
        ? "Clique « Gérer la liste » pour composer la liste des chars prioritaires du clan."
        : "Les officiers n'ont pas encore composé la liste."}</div></div>`;
    return;
  }
  const inList=new Set(PR_LIST);
  panel.innerHTML=`<div class="pr-panel"><div class="pr-title">Chars prioritaires à obtenir</div>
    <div class="pr-cols">${PR_COLS.map(([type,label])=>{
      const list=prTanks().filter(t=>t.type===type && inList.has(Number(t.tank_id)));
      return `<div class="pr-col">
        <div class="pr-col-h">${esc(label)}<span class="pr-col-cnt">${list.length}</span></div>
        <div class="pr-col-list">${list.length?list.map(t=>{
          const id=Number(t.tank_id), opt=prIsOpt(t);
          const tip=[prNrm(t.name), prStatut(t), opt?"Optionnel ou difficile à obtenir":null].filter(Boolean).join(" — ");
          return `<label class="pr-row${opt?" opt":""}${prIsPrem(t)?" prem":""}" title="${esc(tip)}">
            <span class="pr-dot"></span>
            <img class="pr-ic" src="${esc(prIcon(t))}" onerror="this.style.visibility='hidden'" loading="lazy">
            <span class="pr-nm">${esc(prNrm(t.name))}</span>${prGem(t)}
            <input type="checkbox" class="pr-cb" data-own="${id}"${PR_OWNED.has(id)?" checked":""}
              title="Je possède ce char"></label>`;
        }).join(""):'<div class="pr-col-empty">—</div>'}</div></div>`;
    }).join("")}</div>
    <div class="pr-legend">
      <span class="pr-leg"><span class="pr-dot"></span>Violet : char optionnel ou difficile à obtenir — campagne, atelier d'assemblage ou box</span>
      <span class="pr-leg pr-leg-prem"><svg class="pr-prem-ic"><use href="#i-prem"/></svg>Doré : char premium ou de collection — ne se débloque pas à l'XP</span>
    </div></div>`;
  panel.querySelectorAll("[data-own]").forEach(cb=>cb.onchange=()=>{
    const id=Number(cb.dataset.own);
    cb.checked ? PR_OWNED.add(id) : PR_OWNED.delete(id);
    prRenderProg();
    fnCall("loadouts",{session:localStorage.getItem(LS_SESSION),
      action:"prio_owned", tank_id:id, owned:cb.checked});   // donnée du joueur
  });
}
function prRenderProg(){
  const total=PR_LIST.length, inList=new Set(PR_LIST);
  const mine=[...PR_OWNED].filter(id=>inList.has(id)).length;
  const pct=total?Math.round(mine/total*100):0;
  document.getElementById("prProg").innerHTML = total
    ? `Tu possèdes <b>${mine}</b> des <b>${total}</b> chars prioritaires
       <div class="pr-bar"><i style="width:${pct}%"></i></div>` : "";
  const c=document.getElementById("loPrioCnt");
  c.textContent=total; c.dataset.zero = total?"0":"1";
}
/* ---------- Éditeur (officiers de combat et +) ---------- */
function prOpenEditor(){
  if(!PR_CANEDIT) return;
  PR_DRAFT=new Set(PR_LIST); PR_Q="";
  document.getElementById("prEditor").classList.remove("hidden");
  document.getElementById("prPanel").classList.add("hidden");
  document.getElementById("prEditBtn").classList.add("hidden");
  prRenderEditor();
}
function prCloseEditor(){
  PR_DRAFT=null;
  const ed=document.getElementById("prEditor");
  if(!ed) return;
  ed.classList.add("hidden"); ed.innerHTML="";
  document.getElementById("prPanel").classList.remove("hidden");
  document.getElementById("prEditBtn").classList.toggle("hidden", !PR_CANEDIT);
}
function prRenderEditor(){
  const q=PR_Q.trim().toLowerCase();
  document.getElementById("prEditor").innerHTML=`<div class="pr-ed">
    <div class="pr-ed-h">
      <div><b>Composer la liste des chars prioritaires</b>
        <span>Coche les chars à faire figurer dans la liste du clan. Le violet est automatique : il marque les chars premium.</span></div>
      <button class="pr-ed-x" id="prEdX">✕ Annuler</button>
    </div>
    <div class="pr-ed-flt"><input type="search" id="prEdQ" placeholder="Chercher un char…" autocomplete="off" value="${esc(PR_Q)}"></div>
    <div class="pr-cols">${PR_COLS.map(([type,label])=>{
      const list=prTanks().filter(t=>t.type===type && (!q || prNrm(t.name).toLowerCase().includes(q)));
      return `<div class="pr-col">
        <div class="pr-col-h">${esc(label)}<span class="pr-col-cnt">${list.filter(t=>PR_DRAFT.has(Number(t.tank_id))).length}/${list.length}</span></div>
        <div class="pr-col-list">${list.length?list.map(t=>{
          const id=Number(t.tank_id), inl=PR_DRAFT.has(id);
          return `<label class="pr-ed-row${inl?" in":""}${prIsOpt(t)?" opt":""}${prIsPrem(t)?" prem":""}"
              title="${esc([prNrm(t.name),prStatut(t)].filter(Boolean).join(" — "))}">
            <input type="checkbox" class="pr-cb" data-in="${id}"${inl?" checked":""} title="Faire figurer dans la liste">
            <img class="pr-ic" src="${esc(prIcon(t))}" onerror="this.style.visibility='hidden'" loading="lazy">
            <span class="pr-nm">${esc(prNrm(t.name))}</span>${prGem(t)}
            <span class="pr-dot"></span></label>`;
        }).join(""):'<div class="pr-col-empty">Aucun char</div>'}</div></div>`;
    }).join("")}</div>
    <div class="pr-ed-f">
      <div class="pr-ed-l"><span id="prEdCount"></span>
        <button class="pr-reset" id="prEdReset" title="Vide la liste. Rien n'est perdu tant que tu n'as pas enregistré.">↺ Réinitialiser</button></div>
      <div class="pr-ed-act"><button id="prEdCancel">Annuler</button>
        <button class="pr-save" id="prEdSave">✓ Enregistrer la liste</button></div>
    </div></div>`;
  prWireEditor(); prEdCount();
}
function prEdCount(){
  const opt=prTanks().filter(t=>PR_DRAFT.has(Number(t.tank_id)) && prIsOpt(t)).length;
  document.getElementById("prEdCount").textContent = PR_DRAFT.size
    ? `${PR_DRAFT.size} char${PR_DRAFT.size>1?"s":""} dans la liste · ${opt} en violet` : "Liste vide";
  document.getElementById("prEdReset").classList.toggle("hidden", !PR_DRAFT.size);
}
function prWireEditor(){
  const q=document.getElementById("prEdQ");
  q.oninput = e => { PR_Q=e.target.value; prRenderEditor();
    const f=document.getElementById("prEdQ"); f.focus(); f.setSelectionRange(f.value.length,f.value.length); };
  document.querySelectorAll("[data-in]").forEach(cb=>cb.onchange=()=>{
    const id=Number(cb.dataset.in);
    cb.checked ? PR_DRAFT.add(id) : PR_DRAFT.delete(id);
    cb.closest(".pr-ed-row").classList.toggle("in", cb.checked);
    prEdCount();
  });
  document.getElementById("prEdReset").onclick = ()=>{ PR_DRAFT.clear(); prRenderEditor(); };
  document.getElementById("prEdX").onclick = prCloseEditor;
  document.getElementById("prEdCancel").onclick = prCloseEditor;
  document.getElementById("prEdSave").onclick = async ()=>{
    const tanks=[...PR_DRAFT];
    const r=await fnCall("loadouts",{session:localStorage.getItem(LS_SESSION),action:"prio_set",tanks});
    if(!r.ok){ alert("Enregistrement impossible : "+((r.j&&r.j.error)||r.status)); return; }
    PR_LIST=tanks; prCloseEditor(); prRenderAll();
  };
}
/* Ce bouton n'existe que sur index.html. Sans ce garde, la page dédiée
   à la progression mourrait ici, avant même de commencer. */
{ const b = document.getElementById("prEditBtn"); if (b) b.onclick = prOpenEditor; }
function switchLoSub(sub){
  document.querySelectorAll(".lo-subtab").forEach(b=>b.classList.toggle("on",b.dataset.losub===sub));
  document.getElementById("loMain").classList.toggle("hidden", sub!=="loadouts");
  document.getElementById("tlMain").classList.toggle("hidden", sub!=="tier");
  document.getElementById("prioMain").classList.toggle("hidden", sub!=="prio");
  document.getElementById("loNewBtn").classList.toggle("hidden", sub!=="loadouts" || !LO_CANEDIT);
  document.getElementById("tlNewBtn").classList.toggle("hidden", sub!=="tier" || !TL_CANEDIT);
  if(sub==="tier" && !TL_LOADED) loadTierlists();
  if(sub==="prio" && !PR_LOADED) loadPrio();
}
async function loadTierlists(){
  TL_LOADED=true;
  const list=document.getElementById("tlList"); list.innerHTML='<div class="card">'+cpLoader()+'</div>';
  if(!LO_REF || !(LO_REF.tanks||[]).length){ try{ const rf=await fnCall("reference",{session:localStorage.getItem(LS_SESSION)}); if(rf.ok&&rf.j&&rf.j.tanks) LO_REF=rf.j; }catch(e){} }
  try{
    const r=await fnCall("tierlists",{session:localStorage.getItem(LS_SESSION),action:"list"});
    if(!r.ok){ list.innerHTML='<div class="card"><div class="empty">Erreur tier lists : '+esc((r.j&&r.j.error)||String(r.status))+' — la fonction « tierlists » est-elle déployée ?</div></div>'; return; }
    TIERLISTS=r.j.tierlists||[]; TL_CANEDIT=meIsManager();
    if(!document.getElementById("tlMain").classList.contains("hidden")) document.getElementById("tlNewBtn").classList.toggle("hidden",!TL_CANEDIT);
    renderTierlists();
  }catch(e){ list.innerHTML='<div class="card"><div class="empty">Impossible de joindre « tierlists » ('+esc(String(e))+').</div></div>'; }
}
function renderTierlists(){
  const el=document.getElementById("tlList"), M=loMaps();
  if(!TIERLISTS.length){ el.innerHTML=`<div class="lo-empty"><div class="lo-empty-ic">🏆</div><div class="lo-empty-t">Aucune tier list</div><div class="lo-empty-s">${TL_CANEDIT?'Clique « Nouvelle tier list » pour en créer une.':'Les officiers n’ont pas encore créé de tier list.'}</div></div>`; return; }
  el.innerHTML='<div class="tl-cards">'+TIERLISTS.map(tl=>{
    const preview=(tl.rows||[]).slice(0,6).map(r=>`<div class="tl-mini-row"><span class="tl-mini-lbl" style="background:${esc(r.color)}">${esc(r.label)}</span><div class="tl-mini-tanks">${(r.tanks||[]).slice(0,12).map(id=>{const t=M.t[id]; return t?`<img src="${esc(t.icon||'')}" onerror="this.style.display='none'" loading="lazy">`:''; }).join("")}</div></div>`).join("");
    const btns=TL_CANEDIT?`<div class="tl-cardact"><button class="lo-mini" data-tledit="${tl.id}" title="Modifier">✎</button><button class="lo-mini lo-minidel" data-tldel="${tl.id}" title="Supprimer">✕</button></div>`:"";
    return `<div class="tl-card" data-tlopen="${tl.id}"><div class="tl-card-h"><b>${esc(tl.name||"Tier list")}</b>${btns}</div><div class="tl-mini">${preview}</div><div class="tl-card-by">Par ${esc(tl.created_by_name||"?")}</div></div>`;
  }).join("")+'</div>';
  el.querySelectorAll("[data-tlopen]").forEach(c=>c.onclick=e=>{ if(e.target.closest("[data-tledit],[data-tldel]"))return; openTierlistView(TIERLISTS.find(x=>String(x.id)===c.dataset.tlopen)); });
  el.querySelectorAll("[data-tledit]").forEach(b=>b.onclick=e=>{e.stopPropagation();openTierlistEditor(TIERLISTS.find(x=>String(x.id)===b.dataset.tledit));});
  el.querySelectorAll("[data-tldel]").forEach(b=>b.onclick=e=>{e.stopPropagation();deleteTierlist(b.dataset.tldel);});
}
function tlAllTankIds(){ return ((LO_REF&&LO_REF.tanks)||[]).map(t=>Number(t.tank_id)); }
function tlPool(){ const placed=new Set(); TL_EDIT.rows.forEach(r=>r.tanks.forEach(id=>placed.add(Number(id)))); return tlAllTankIds().filter(id=>!placed.has(id)); }
function openTierlistEditor(tl){
  if(!TL_CANEDIT){ alert("Réservé aux officiers de combat et plus."); return; }
  const rows=(tl&&Array.isArray(tl.rows)&&tl.rows.length)? tl.rows.map(r=>({label:r.label||"",color:r.color||"#3a3d42",tanks:(r.tanks||[]).map(Number)})) : TL_DEFAULT_ROWS();
  TL_EDIT={ id:(tl&&tl.id)||null, name:(tl&&tl.name)||"Nouvelle tier list", rows };
  renderTierEditor();
  document.getElementById("tlEditor").scrollIntoView({behavior:"smooth",block:"start"});
}
function tlTankTile(id,drag){ const t=loMaps().t[id]; if(!t) return '';
  return `<div class="tl-tank" ${drag?'draggable="true"':''} data-tank="${id}" title="${esc(t.name)}"><img src="${esc(t.icon||'')}" onerror="this.style.display='none'" loading="lazy"></div>`; }
function renderTierEditor(){
  const ed=document.getElementById("tlEditor"); ed.classList.remove("hidden");
  const rowsHtml=TL_EDIT.rows.map((r,i)=>`<div class="tl-row" data-row="${i}">
    <div class="tl-row-lbl" style="background:${esc(r.color)}"><input class="tl-lbl-in" value="${esc(r.label)}" maxlength="24" data-lbl="${i}" title="Nom du tier">
      <div class="tl-row-ctl"><input type="color" class="tl-color" value="${esc(r.color)}" data-color="${i}" title="Couleur"><button type="button" class="tl-rowbtn" data-rowup="${i}" title="Monter">▲</button><button type="button" class="tl-rowbtn" data-rowdown="${i}" title="Descendre">▼</button><button type="button" class="tl-rowbtn tl-rowdel" data-rowdel="${i}" title="Supprimer la ligne">✕</button></div></div>
    <div class="tl-drop" data-drop="${i}">${r.tanks.map(id=>tlTankTile(id,true)).join("")}</div></div>`).join("");
  const src=(LO_REF.tanks||[]);
  const nats=[...new Set(src.map(x=>x.nation).filter(Boolean))].sort();
  const natOpts='<option value="">Toutes nations</option>'+nats.map(n=>`<option value="${n}"${TL_TNAT===n?' selected':''}>${LO_NATION_FR[n]||n}</option>`).join("");
  const clsOpts='<option value="">Toutes classes</option>'+LO_CLS_OPT.filter(c=>src.some(x=>x.type===c[0])).map(c=>`<option value="${c[0]}"${TL_TCLS===c[0]?' selected':''}>${c[1]}</option>`).join("");
  ed.innerHTML=`<div class="card tl-editor dashx">
    <div class="tl-ed-h"><input class="tl-name" value="${esc(TL_EDIT.name)}" maxlength="80" placeholder="Nom de la tier list"><div class="tl-ed-act"><button class="btn" id="tlAddRow">＋ Ligne</button><button class="btn" id="tlCancel">Annuler</button><button class="btn tl-save" id="tlSave">✓ Enregistrer</button></div></div>
    <div class="tl-rows" id="tlRows">${rowsHtml}</div>
    <div class="tl-pool-h">Chars à classer <span class="hint">glisse-les dans les lignes ↑ (ou reglisse-les ici)</span></div>
    <div class="tl-flt"><select class="lo-fclass" id="tlFCls">${clsOpts}</select><select class="lo-fnation" id="tlFNat">${natOpts}</select><input class="lo-search" id="tlQ" placeholder="Rechercher un char…" value="${esc(TL_TQ)}"></div>
    <div class="tl-pool" id="tlPool" data-drop="pool">${tlPool().map(id=>tlTankTile(id,true)).join("")}</div></div>`;
  tlWireEditor();
}
function tlWireEditor(){
  const ed=document.getElementById("tlEditor");
  ed.querySelector(".tl-name").oninput=e=>TL_EDIT.name=e.target.value;
  document.getElementById("tlAddRow").onclick=()=>{ if(TL_EDIT.rows.length>=12){alert("12 lignes maximum.");return;} TL_EDIT.rows.push({label:"Nouveau",color:"#3a3d42",tanks:[]}); renderTierEditor(); };
  document.getElementById("tlCancel").onclick=()=>{ ed.classList.add("hidden"); ed.innerHTML=""; TL_EDIT=null; };
  document.getElementById("tlSave").onclick=saveTierlist;
  ed.querySelectorAll("[data-lbl]").forEach(inp=>inp.oninput=e=>TL_EDIT.rows[+inp.dataset.lbl].label=e.target.value);
  ed.querySelectorAll("[data-color]").forEach(inp=>inp.oninput=e=>{ TL_EDIT.rows[+inp.dataset.color].color=e.target.value; inp.closest(".tl-row-lbl").style.background=e.target.value; });
  ed.querySelectorAll("[data-rowup]").forEach(b=>b.onclick=()=>{ const i=+b.dataset.rowup; if(i>0){ const r=TL_EDIT.rows.splice(i,1)[0]; TL_EDIT.rows.splice(i-1,0,r); renderTierEditor(); } });
  ed.querySelectorAll("[data-rowdown]").forEach(b=>b.onclick=()=>{ const i=+b.dataset.rowdown; if(i<TL_EDIT.rows.length-1){ const r=TL_EDIT.rows.splice(i,1)[0]; TL_EDIT.rows.splice(i+1,0,r); renderTierEditor(); } });
  ed.querySelectorAll("[data-rowdel]").forEach(b=>b.onclick=()=>{ if(TL_EDIT.rows.length<=1)return; if(!confirm("Supprimer cette ligne ? Ses chars retournent au pool.")) return; TL_EDIT.rows.splice(+b.dataset.rowdel,1); renderTierEditor(); });
  const q=document.getElementById("tlQ"),fc=document.getElementById("tlFCls"),fn=document.getElementById("tlFNat"),M=loMaps();
  const applyF=()=>{ TL_TQ=q.value; TL_TCLS=fc.value; TL_TNAT=fn.value; const qq=TL_TQ.toLowerCase();
    document.querySelectorAll("#tlPool .tl-tank").forEach(el=>{ const t=M.t[+el.dataset.tank]||{}; const ok=(!qq||String(t.name||'').toLowerCase().indexOf(qq)>=0)&&(!TL_TCLS||t.type===TL_TCLS)&&(!TL_TNAT||t.nation===TL_TNAT); el.style.display=ok?'':'none'; }); };
  q.oninput=applyF; fc.onchange=applyF; fn.onchange=applyF; applyF();
  ed.querySelectorAll(".tl-tank").forEach(tile=>{
    tile.ondragstart=e=>{ TL_DRAG=+tile.dataset.tank; e.dataTransfer.effectAllowed="move"; try{e.dataTransfer.setData("text/plain",String(TL_DRAG));}catch(_){} setTimeout(()=>tile.classList.add("dragging"),0); };
    tile.ondragend=()=>{ tile.classList.remove("dragging"); ed.querySelectorAll(".tl-drop.over,.tl-pool.over").forEach(d=>d.classList.remove("over")); };
  });
  ed.querySelectorAll("[data-drop]").forEach(zone=>{
    zone.ondragover=e=>{ e.preventDefault(); e.dataTransfer.dropEffect="move"; zone.classList.add("over"); };
    zone.ondragleave=()=>zone.classList.remove("over");
    zone.ondrop=e=>{ e.preventDefault(); zone.classList.remove("over"); const id=TL_DRAG||Number(e.dataTransfer.getData("text/plain")); if(id) tlMoveTank(id,zone.dataset.drop); };
  });
}
function tlMoveTank(id,target){
  id=Number(id);
  TL_EDIT.rows.forEach(r=>{ const i=r.tanks.indexOf(id); if(i>=0) r.tanks.splice(i,1); });
  if(target!=="pool"){ const ri=+target; if(TL_EDIT.rows[ri] && TL_EDIT.rows[ri].tanks.indexOf(id)<0) TL_EDIT.rows[ri].tanks.push(id); }
  TL_DRAG=null; renderTierEditor();
}
async function saveTierlist(){
  const payload={ id:TL_EDIT.id||null, name:(TL_EDIT.name||"Tier list").trim()||"Tier list", rows:TL_EDIT.rows.map(r=>({label:r.label,color:r.color,tanks:r.tanks})) };
  const btn=document.getElementById("tlSave"); if(btn){btn.disabled=true;btn.textContent="Enregistrement…";}
  const r=await fnCall("tierlists",{session:localStorage.getItem(LS_SESSION),action:"save",tierlist:payload});
  if(!r.ok){ if(btn){btn.disabled=false;btn.textContent="✓ Enregistrer";} alert("Erreur : "+(r.j.error||r.status)); return; }
  const ed=document.getElementById("tlEditor"); ed.classList.add("hidden"); ed.innerHTML=""; TL_EDIT=null;
  loadTierlists();
}
async function deleteTierlist(id){
  if(!confirm("Supprimer cette tier list ?")) return;
  const r=await fnCall("tierlists",{session:localStorage.getItem(LS_SESSION),action:"delete",id:Number(id)});
  if(!r.ok){ alert("Erreur : "+(r.j.error||r.status)); return; }
  loadTierlists();
}
function openTierlistView(tl){
  if(!tl) return; const M=loMaps();
  const ed=document.getElementById("tlEditor"); ed.classList.remove("hidden");
  const rowsHtml=(tl.rows||[]).map(r=>`<div class="tl-row tl-row-view"><div class="tl-row-lbl tl-row-lbl-view" style="background:${esc(r.color)}">${esc(r.label)}</div><div class="tl-drop">${(r.tanks||[]).map(id=>{const t=M.t[id];return t?`<div class="tl-tank" title="${esc(t.name)}"><img src="${esc(t.icon||'')}" onerror="this.style.display='none'" loading="lazy"></div>`:'';}).join("")||'<span class="tl-empty-row">—</span>'}</div></div>`).join("");
  ed.innerHTML=`<div class="card tl-editor dashx"><div class="tl-ed-h"><b class="tl-view-name">${esc(tl.name||"Tier list")}</b><div class="tl-ed-act">${TL_CANEDIT?`<button class="btn" id="tlEditThis">✎ Modifier</button>`:""}<button class="btn" id="tlCloseView">Fermer</button></div></div><div class="tl-rows">${rowsHtml}</div><div class="tl-card-by">Par ${esc(tl.created_by_name||"?")}</div></div>`;
  document.getElementById("tlCloseView").onclick=()=>{ ed.classList.add("hidden"); ed.innerHTML=""; };
  const eb=document.getElementById("tlEditThis"); if(eb) eb.onclick=()=>openTierlistEditor(tl);
  ed.scrollIntoView({behavior:"smooth",block:"start"});
}

/* ============================================================
   STRATÉGIE — éditeur de minimap (style StratSketch)
   ============================================================ */
let STRATS=[], STRAT_CANEDIT=false, STRAT_LOADED=false, STRAT_ME=null;
// peut éditer CETTE stratégie : officier/manager, OU collaborateur listé dans editors
// ⚠️ STRAT_CANEDIT n'est renseigné qu'après le chargement de l'onglet Stratégie.
// En arrivant d'ailleurs (bouton « Débriefer » des batailles) il vaut encore false :
// on retombe donc sur le calcul local (grade réel / admin). Le serveur reste juge
// à l'enregistrement.
function stCanEditNow(){ return STRAT_CANEDIT || isAppAdmin() || meIsManager(); }
function stCanEdit(s){ return stCanEditNow() || (s && Array.isArray(s.editors) && s.editors.map(Number).includes(Number(STRAT_ME))); }
// ===== Temps réel : présence + édition simultanée (Supabase Realtime) =====
let SB_CLIENT=null, ST_ROOM=null, ST_BC_LOOP=null, ST_BC_LAST='';
function stRtClient(){ if(SB_CLIENT) return SB_CLIENT; if(!(window.supabase&&window.supabase.createClient)) return null;
  try{ SB_CLIENT=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON,{realtime:{params:{eventsPerSecond:8}}}); }catch(_){ SB_CLIENT=null; } return SB_CLIENT; }
function stMyName(){ const m=(MEMBERS||[]).find(x=>Number(x.account_id)===Number(STRAT_ME)); return (m&&(m.nickname||m.name))||'Moi'; }
function stJoinRoom(sid,role){ const sb=stRtClient(); if(!sb||!sid) return; stLeaveRoom();
  const ch=sb.channel('strat-'+sid,{config:{presence:{key:String(STRAT_ME||('g'+Math.random().toString(36).slice(2)))}}});
  ch.on('presence',{event:'sync'},stRenderPresence);
  ch.on('presence',{event:'join'},stRenderPresence);
  ch.on('presence',{event:'leave'},stRenderPresence);
  ch.on('broadcast',{event:'els'},({payload})=>stApplyRemoteEls(payload));
  ch.on('broadcast',{event:'ptr'},({payload})=>stPtrRemote(payload));   // pointeur d'un collaborateur
  ch.subscribe(async status=>{ if(status==='SUBSCRIBED'){ try{ await ch.track({id:STRAT_ME,name:stMyName(),role,at:Date.now()}); }catch(_){} } });
  ST_ROOM=ch;
  if(role==='edit'){ ST_BC_LAST=ST_EDIT?JSON.stringify(ST_EDIT.steps):''; stStartBroadcastLoop(); }
}
function stLeaveRoom(){ stStopBroadcastLoop(); if(ST_ROOM&&SB_CLIENT){ try{ SB_CLIENT.removeChannel(ST_ROOM); }catch(_){} } ST_ROOM=null; document.querySelectorAll('.st-presence').forEach(b=>b.innerHTML=''); }
function stPresenceUsers(){ if(!ST_ROOM) return []; let st={}; try{ st=ST_ROOM.presenceState(); }catch(_){ return []; }
  const seen={},out=[]; Object.values(st).forEach(a=>a.forEach(m=>{ const k=String(m.id!=null?m.id:m.name); if(!seen[k]){ seen[k]=1; out.push(m); } })); return out; }
function stRenderPresence(){ const boxes=document.querySelectorAll('.st-presence'); if(!boxes.length) return; const us=stPresenceUsers();
  const html=us.map(u=>`<span class="st-pres${u.role==='edit'?' editing':''}" title="${esc(u.name||'?')} — ${u.role==='edit'?'édite':'regarde'}">${esc(String(u.name||'?').slice(0,14))}${u.role==='edit'?' ✎':' 👁'}</span>`).join('');
  boxes.forEach(b=>b.innerHTML=html); }
function stStartBroadcastLoop(){ stStopBroadcastLoop(); ST_BC_LOOP=setInterval(()=>{ if(!ST_ROOM||!ST_EDIT||ST_MOVE||ST_DRAW||ST_XFORM||ST_PATHBUILD) return; let j; try{ j=JSON.stringify(ST_EDIT.steps); }catch(_){ return; } if(j!==ST_BC_LAST){ ST_BC_LAST=j; try{ ST_ROOM.send({type:'broadcast',event:'els',payload:{by:STRAT_ME,steps:ST_EDIT.steps}}); }catch(_){} } },400); }
function stStopBroadcastLoop(){ if(ST_BC_LOOP){ clearInterval(ST_BC_LOOP); ST_BC_LOOP=null; } }
function stApplyRemoteEls(p){ if(!p||!ST_EDIT||String(p.by)===String(STRAT_ME)||ST_MOVE||ST_DRAW||ST_XFORM||ST_PATHBUILD||!Array.isArray(p.steps)||!p.steps.length) return;
  // ⚠️ Conserver `note` ET `t` : ne garder que `els` effaçait les notes et les
  // instants épinglés des diapos de débrief dès qu'un collaborateur dessinait.
  ST_EDIT.steps=p.steps.map(s=>({ els:Array.isArray(s.els)?s.els:[], note:String(s&&s.note||''),
                                  t:(s&&s.t!=null&&isFinite(s.t))?Number(s.t):null }));
  if(ST_STEP>=ST_EDIT.steps.length) ST_STEP=ST_EDIT.steps.length-1; ST_EDIT.els=ST_EDIT.steps[ST_STEP].els; stSelClear();
  ST_BC_LAST=JSON.stringify(ST_EDIT.steps);
  if(document.getElementById('stStepTabs')) renderStepTabs(); stRedraw(); if(typeof stUpdCount==='function') stUpdCount(); }
let ST_EDIT=null;   // {id,name,map,els:[]}
let ST_TOOL='arrow', ST_COLOR='#e5544b', ST_DRAW=null, ST_MOVE=null;
let ST_SELS=new Set();   // indices des éléments sélectionnés (multi-sélection)
let ST_BOX=null;         // rectangle de sélection en cours
let ST_XFORM=null;       // redimensionnement / rotation en cours
let ST_CLIP=[];          // presse-papier (copier/coller)
let ST_SNAP=(typeof localStorage!=='undefined' && localStorage.getItem('cp_stsnap')==='1');   // aimantation à la grille
const SNAP_STEP=50;      // pas d'aimantation (0-1000)
function stSnap(v){ return Math.round(v/SNAP_STEP)*SNAP_STEP; }
let ST_TANK={cls:'medium',color:'#5dbb46',size:0.78};   // "pinceau" pion de char courant (classe + couleur + taille, petit par défaut)
const ST_TANK_SIZES=[["Petit",0.78],["Moyen",1.0],["Grand",1.3]];
const ST_TANK_COLORS=[["#5dbb46","Vert (alliés)"],["#e0483f","Rouge (ennemis)"],["#e5c84b","Jaune"],["#5bb0e5","Bleu"],["#c264ff","Violet"],["#ffffff","Blanc"]];
let ST_STAMP={kind:'focus',size:0.75};   // symbole tactique courant (+ taille, petit par défaut)
const ST_STAMP_SIZES=[["Petit",0.75],["Moyen",1.05],["Grand",1.4]];
let ST_CONE={spread:30};                 // demi-angle du cône de tir (degrés)
const ST_CONE_SPREADS=[["Étroit",15],["Moyen",30],["Large",50]];
let ST_PATHBUILD=null;                    // trajet multipoint en cours de construction
// Formations pré-enregistrées : décalages relatifs des pions (unités viewBox 0-1000).
const ST_FORMATIONS=[["line","Ligne"],["column","Colonne"],["wedge","Coin"],["echelon","Échelon"]];
const ST_FORM_SHAPES={
  line:[[-116,0],[-58,0],[0,0],[58,0],[116,0]],
  column:[[0,-116],[0,-58],[0,0],[0,58],[0,116]],
  wedge:[[0,-72],[-48,-26],[48,-26],[-96,20],[96,20]],
  echelon:[[-96,-72],[-48,-36],[0,0],[48,36],[96,72]],
};
// Symboles tactiques : SVG dessiné dans une boîte ~ -15..15, coloré via currentColor.
const ST_STAMPS={
  focus:'<circle r="13"/><circle r="5"/><path d="M0,-15 V-11 M0,15 V11 M-15,0 H-11 M15,0 H11"/>',
  spot:'<path d="M-15,0 Q0,-10 15,0 Q0,10 -15,0 Z"/><circle r="4" fill="currentColor" stroke="none"/>',
  defend:'<path d="M0,-15 L12,-9 V1 Q12,11 0,15 Q-12,11 -12,1 V-9 Z"/><path d="M-5,-1 L-1,4 L6,-6"/>',
  danger:'<path d="M0,-14 L14,12 H-14 Z"/><path d="M0,-5 V4"/><circle cx="0" cy="8" r="1.5" fill="currentColor" stroke="none"/>',
  objective:'<path d="M-8,-15 V15 M-8,-14 H11 L6,-8 L11,-2 H-8"/>',
  push:'<path d="M-12,-11 L0,0 L-12,11 M1,-11 L13,0 L1,11"/>',
  fallback:'<path d="M9,13 V0 A9,9 0 0 0 -9,0 V5"/><path d="M-9,5 L-13,1 M-9,5 L-5,1"/>',
  stop:'<circle r="13"/><path d="M-8,0 H8"/>',
  rally:'<path d="M-14,-14 L-6,-6 M-13,-14 H-6 V-13 M14,-14 L6,-6 M13,-14 H6 V-13 M-14,14 L-6,6 M-13,14 H-6 V13 M14,14 L6,6 M13,14 H6 V13"/><circle r="2.6" fill="currentColor" stroke="none"/>'
};
const ST_STAMP_LIST=[["focus","Focus"],["spot","Vision"],["defend","Tenir"],["danger","Danger"],["objective","Objectif"],["push","Pousser"],["fallback","Repli"],["stop","Interdit"],["rally","Regroupement"]];
// échelle réelle de la carte : côté de la boundingBox officielle = taille en mètres (repli 1000).
function stMapMeters(){ const b=ST_BASES&&ST_EDIT&&ST_BASES[ST_EDIT.map]&&ST_BASES[ST_EDIT.map].bbox; return b?Math.round(b[2]-b[0]):1000; }
let ST_UNDO=[], ST_REDO=[];          // historique annuler/refaire (snapshots JSON de ST_EDIT.els)
let ST_STEP=0;                       // étape courante (slideshow) ; ST_EDIT.els = ST_EDIT.steps[ST_STEP].els
let ST_STROKE={dash:false,w:7,curve:false};   // style de trait courant (flèche/ligne/crayon/forme)
// Grille A-K / 1-0 : ACTIVE PAR DÉFAUT (on ne la masque que si l'utilisateur l'a
// explicitement désactivée). C'est le repère commun pour parler d'une position.
let ST_GRID = (typeof localStorage==='undefined') || localStorage.getItem('cp_stgrid')!=='0';
let ST_ZOOM={x:0,y:0,w:1000,h:1000};   // viewBox courant du canvas (zoom + déplacement)
let ST_PANNING=null, ST_SPACE=false;   // déplacement (main) en cours / barre Espace maintenue
let ST_FULL=true;                      // éditeur en plein écran (défaut)
// raccourcis clavier : touche -> outil
const ST_KEYS={v:'select',h:'tank',f:'arrow',l:'line',z:'rect',o:'circle',s:'stamp',d:'measure',r:'range',c:'cone',m:'path',p:'pen',j:'marker',t:'text',g:'erase'};
function stApplyZoom(){ const svg=document.getElementById("stSvg"); if(!svg) return;
  const W=ST_ZOOM.w=ST_ZOOM.h=Math.max(250,Math.min(1000,ST_ZOOM.w));   // viewBox carré, zoom max x4
  ST_ZOOM.x=Math.max(0,Math.min(1000-W,ST_ZOOM.x)); ST_ZOOM.y=Math.max(0,Math.min(1000-W,ST_ZOOM.y));
  svg.setAttribute("viewBox",`${Math.round(ST_ZOOM.x)} ${Math.round(ST_ZOOM.y)} ${Math.round(W)} ${Math.round(W)}`);
  const lvl=document.getElementById("stZoomLvl"); if(lvl) lvl.textContent=Math.round(1000/W*100)+"%"; stMiniSync(); }
// Mini-carte de navigation : affichée seulement en zoom, avec le cadre de la zone visible.
function stMiniSync(){ const mm=document.getElementById("stMinimap"), vp=document.getElementById("stMiniVp"); if(!mm||!vp) return;
  const zoomed=ST_ZOOM.w<999; mm.style.display=zoomed?'block':'none'; if(!zoomed) return; const P=v=>Math.max(0,Math.min(100,v/1000*100));
  vp.style.left=P(ST_ZOOM.x)+'%'; vp.style.top=P(ST_ZOOM.y)+'%'; vp.style.width=P(ST_ZOOM.w)+'%'; vp.style.height=P(ST_ZOOM.h)+'%'; }
function stZoomAt(factor,cx,cy){ const nw=Math.max(250,Math.min(1000,ST_ZOOM.w*factor));
  // garde le point (cx,cy) fixe sous le curseur (cx,cy en coords 0-1000)
  ST_ZOOM.x=cx-(cx-ST_ZOOM.x)*(nw/ST_ZOOM.w); ST_ZOOM.y=cy-(cy-ST_ZOOM.y)*(nw/ST_ZOOM.w);
  ST_ZOOM.w=ST_ZOOM.h=nw; stApplyZoom(); }
function stZoomReset(){ ST_ZOOM={x:0,y:0,w:1000,h:1000}; stApplyZoom(); }
// grille officielle WoT : 10x10, colonnes 1-0, lignes A-K (le I est sauté)
function stGridInner(){ let s=''; const cols='1234567890'.split(''), rows='ABCDEFGHJK'.split('');
  for(let i=1;i<10;i++){ s+=`<line x1="${i*100}" y1="0" x2="${i*100}" y2="1000" stroke="#fff" stroke-opacity=".2" stroke-width="1.4"/><line x1="0" y1="${i*100}" x2="1000" y2="${i*100}" stroke="#fff" stroke-opacity=".2" stroke-width="1.4"/>`; }
  for(let c=0;c<10;c++) s+=`<text x="${c*100+50}" y="26" font-size="24" font-weight="800" fill="#fff" fill-opacity=".62" text-anchor="middle" paint-order="stroke" stroke="#000" stroke-width="2">${cols[c]}</text>`;
  for(let r=0;r<10;r++) s+=`<text x="20" y="${r*100+62}" font-size="24" font-weight="800" fill="#fff" fill-opacity=".62" text-anchor="middle" paint-order="stroke" stroke="#000" stroke-width="2">${rows[r]}</text>`;
  return s; }
// chemin d'une flèche/ligne courbe (bezier quadratique, contrôle perpendiculaire au milieu)
function stCurvePath(el){ const mx=(el.x1+el.x2)/2,my=(el.y1+el.y2)/2, dx=el.x2-el.x1,dy=el.y2-el.y1, len=Math.hypot(dx,dy)||1, off=len*0.26; const cx=mx+(-dy/len)*off, cy=my+(dx/len)*off; return `M ${el.x1} ${el.y1} Q ${Math.round(cx)} ${Math.round(cy)} ${el.x2} ${el.y2}`; }
// construit les étapes d'une stratégie (nouveau format .steps, sinon .elements sur 1 étape)
function stStepsOf(s){ if(s&&Array.isArray(s.steps)&&s.steps.length) return s.steps.map(st=>({els:Array.isArray(st.els)?JSON.parse(JSON.stringify(st.els)):[], note:st.note?String(st.note):'', t:(st.t!=null&&isFinite(st.t)?Number(st.t):null)})); const e=(s&&Array.isArray(s.elements))?JSON.parse(JSON.stringify(s.elements)):[]; return [{els:e,note:''}]; }
const ST_MAPS=[
  ["himmelsdorf","Himmelsdorf"],["ensk","Ensk"],["lakeville","Lakeville"],["redshire","Redshire"],
  ["prohorovka","Prokhorovka"],["murovanka","Murovanka"],["malinovka","Malinovka"],["ruinberg","Ruinberg"],
  ["siegfriedline","Ligne Siegfried"],["steppes","Steppes"],["tundra","Toundra"],["cliff","Falaise"],
  ["fjord","Fjords"],["fishingbay","Baie du pêcheur"],["erlenberg","Erlenberg"],["elhallouf","El Halluf"],
  ["karelia","Carélie"],["mannerheimline","Ligne Mannerheim"],["westfeld","Westfield"],["airfield","Aérodrome"],
  ["monastery","Abbaye"],["desert","Rivière de sable"],["hills","Live Oaks"],["caucasus","Caucase"],
  ["czech","Pilsen"],["poland","Studzianki"],["germany","Ruhrland"],["munchen","Munich"],
  ["japort","Baie de la nacre"],["northamerica","Highway"],["asiagreatwall","Frontière de l’empire"],["sweden","Kleinberg"]
];
const ST_MAPNAME=Object.fromEntries(ST_MAPS.map(m=>[m[0],m[1]]));
const ST_COLORS=["#e5544b","#e5c84b","#5bb0e5","#8fd14f","#ffffff","#e59a4b","#c264ff","#141414"];
const ST_TOOLS=[["select","Déplacer","✋"],["tank","Chars","▰"],["arrow","Flèche","➤"],["line","Trait","／"],["rect","Zone","▭"],["circle","Cercle","◯"],["stamp","Symbole","✪"],["cone","Cône de tir","◔"],["path","Trajet","⋯"],["measure","Mesure","↔"],["range","Portée","◎"],["pen","Crayon","✎"],["marker","Jeton","◉"],["text","Texte","T"],["erase","Gomme","⌫"]];
const ST_CLASSES=[["light","Léger"],["medium","Moyen"],["heavy","Lourd"],["td","TD"],["spg","Arto"]];   // classes = silhouettes officielles du jeu (web/strat/class_*.png)
// Icônes SVG des outils (style ligne, cohérent avec la DA du site — viewBox 0 0 24 24).
const ST_TOOL_ICONS={
  select:'<path d="M5 3l14 6.5-6 1.8-1.8 6z"/>',
  tank:'<path d="M4 13h13v3.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><rect x="8" y="9" width="6" height="4" rx="1"/><path d="M13.5 11H20"/>',
  arrow:'<path d="M4 12h13"/><path d="M12 7l5 5-5 5"/>',
  line:'<path d="M5 19L19 5"/>',
  rect:'<rect x="4" y="6.5" width="16" height="11" rx="1.5"/>',
  circle:'<circle cx="12" cy="12" r="8"/>',
  stamp:'<path d="M12 3l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 8.7l5.4-.8z"/>',
  cone:'<path d="M12 20L5.5 6.5a13 13 0 0 1 13 0z" fill="currentColor" fill-opacity=".18"/><circle cx="12" cy="20" r="1.6" fill="currentColor" stroke="none"/>',
  path:'<path d="M4 18L9 9l5 4 6-9" fill="none"/><circle cx="4" cy="18" r="1.7" fill="currentColor" stroke="none"/><circle cx="9" cy="9" r="1.7" fill="currentColor" stroke="none"/><circle cx="14" cy="13" r="1.7" fill="currentColor" stroke="none"/><circle cx="20" cy="4" r="1.7" fill="currentColor" stroke="none"/>',
  measure:'<path d="M4 8l4-4 12 12-4 4z"/><path d="M8.5 8.5l1.6 1.6M11.5 5.5l1.6 1.6M14.5 8.5l1.6 1.6"/>',
  range:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none"/>',
  pen:'<path d="M4 20l1.2-4L16 5.2l2.8 2.8L8 18.8z"/><path d="M14 7.2l2.8 2.8"/>',
  marker:'<path d="M12 21s6-5.6 6-10a6 6 0 0 0-12 0c0 4.4 6 10 6 10z"/><circle cx="12" cy="11" r="2.3"/>',
  text:'<path d="M5 6.5V4.5h14v2M12 4.5v15M9 19.5h6"/>',
  erase:'<path d="M8.5 20H20"/><path d="M15 5l4 4-7.5 7.5H7L4 13.5z"/>'
};
let ST_BASES=null;   // positions officielles des bases (web/maps_bases.json)
const ST_MODE_FR={ctf:"Standard",domination:"Rencontre",assault:"Assaut",assault2:"Assaut",comp7:"7 vs 7",epic:"Ligne de front"};
// convertit une position monde (x,z) en coords minimap 0-1000 selon la boundingBox
function stWorld(map,x,z){ const b=ST_BASES&&ST_BASES[map]&&ST_BASES[map].bbox; if(!b) return [0,0];
  return [ (x-b[0])/((b[2]-b[0])||1)*1000, (b[3]-z)/((b[3]-b[1])||1)*1000 ]; }
// Marqueurs OFFICIELS extraits du jeu (gui/flash/atlases/battleAtlas -> web/strat/*.png)
const ST_ICON=56;   // taille du marqueur dans le repère 0-1000
// drapeau de base : kind = 'green' (équipe 1) | 'red' (équipe 2) | 'neutral' (point de contrôle, blanc)
function stFlag(mx,my,kind){ const f=(kind==='red')?'base_red':(kind==='neutral')?'base_neutral':'base_green'; const h=ST_ICON/2; return `<image class="st-ov" href="strat/${f}.png" x="${Math.round(mx)-h}" y="${Math.round(my)-h}" width="${ST_ICON}" height="${ST_ICON}"/>`; }
// point d'apparition officiel numéroté : team = 1|2 (couleur), n = numéro 1..4
function stSpawn(mx,my,team,n){ const c=team===1?'green':'red', k=Math.max(1,Math.min(4,n||1)); const h=ST_ICON/2; return `<image class="st-ov" href="strat/spawn_${c}_${k}.png" x="${Math.round(mx)-h}" y="${Math.round(my)-h}" width="${ST_ICON}" height="${ST_ICON}"/>`; }
const ST_MODE_ORDER=["ctf","domination"];   // seulement Standard + Rencontre
function stModes(map){ const md=ST_BASES&&ST_BASES[map]; if(!md||!md.modes) return []; return ST_MODE_ORDER.filter(mo=>md.modes[mo]); }
/* Charge maps_bases.json à la demande. Nécessaire car il n'était chargé que par
   loadStrats() : en arrivant par « Débriefer » (onglet Batailles), l'éditeur
   s'ouvrait sans ce fichier et AUCUNE base ne s'affichait. */
async function stEnsureBases(){
  if(ST_BASES) return;
  try{ const b=await fetch('maps_bases.json',{cache:'no-cache'}); ST_BASES=b.ok?await b.json():{}; }
  catch(_){ ST_BASES={}; }
  const g=document.getElementById("stBases");
  if(g&&ST_EDIT) g.innerHTML=stBasesSvg(ST_EDIT.map,ST_EDIT.mode);
}
function stBasesSvg(map,mode){
  // En débrief, les bases viennent du REPLAY : ce sont les positions réelles de la
  // bataille, et cela marche sur toutes les cartes (maps_bases.json n'en couvre que 32).
  if(ST_RP && ST_RP.map===map && Array.isArray(ST_RP.bases) && ST_RP.bases.length){
    return ST_RP.bases.map(b=>{ const p=stRpXY(b.x,b.z);
      return stFlag(p[0],p[1], b.team==="ally"?'green':(b.team==="enemy"?'red':'neutral')); }).join('');
  }
  const md=ST_BASES&&ST_BASES[map]; if(!md||!md.modes||!md.modes[mode]) return '';
  const m=md.modes[mode]; let s='';
  (m.bases||[]).forEach(b=>{ const p=stWorld(map,b.x,b.z); s+=stFlag(p[0],p[1], b.team===1?'green':'red'); });
  if(m.control){ const p=stWorld(map,m.control[0],m.control[1]); s+=stFlag(p[0],p[1],'neutral'); }
  const cnt={1:0,2:0}; (m.spawns||[]).forEach(sp=>{ cnt[sp.team]=(cnt[sp.team]||0)+1; const p=stWorld(map,sp.x,sp.z); s+=stSpawn(p[0],p[1], sp.team, cnt[sp.team]); });
  return s;
}
function stTextOn(hex){ hex=String(hex||"").replace("#",""); if(hex.length===3) hex=hex.split("").map(c=>c+c).join(""); const r=parseInt(hex.slice(0,2),16)||0,g=parseInt(hex.slice(2,4),16)||0,b=parseInt(hex.slice(4,6),16)||0; return (0.299*r+0.587*g+0.114*b)>150?"#141414":"#fff"; }
async function loadStrats(){
  STRAT_LOADED=true;
  const list=document.getElementById("stList"); list.innerHTML='<div class="card">'+cpLoader()+'</div>';
  if(!ST_BASES){ try{ const b=await fetch('maps_bases.json',{cache:'no-cache'}); if(b.ok) ST_BASES=await b.json(); }catch(e){ ST_BASES={}; } }
  try{
    const r=await fnCall("strategies",{session:localStorage.getItem(LS_SESSION),action:"list"});
    if(!r.ok){ list.innerHTML='<div class="card"><div class="empty">Erreur stratégies : '+esc((r.j&&r.j.error)||String(r.status))+' — la fonction « strategies » est-elle déployée ?</div></div>'; return; }
    // le serveur fait foi (il applique déjà grade + ADMIN_IDS) ; repli sur le calcul local
    STRATS=r.j.strategies||[]; STRAT_ME=(r.j.me!=null?Number(r.j.me):ME_ID);
    STRAT_CANEDIT=(r.j.canEdit!=null ? !!r.j.canEdit : meIsManager()) || isAppAdmin();
    document.getElementById("stNewBtn").classList.toggle("hidden",!STRAT_CANEDIT);
    document.getElementById("stRole").textContent = isAppAdmin()
      ? "Mode administrateur : accès complet aux stratégies."
      : (STRAT_CANEDIT ? "Ton grade te permet de créer et modifier les stratégies."
                       : "Consultation : tu peux ouvrir et lire les stratégies du clan.");
    renderStrats();
  }catch(e){ list.innerHTML='<div class="card"><div class="empty">Impossible de joindre « strategies » ('+esc(String(e))+').</div></div>'; }
}
function renderStrats(){
  const el=document.getElementById("stList");
  if(!STRATS.length){ el.innerHTML=`<div class="lo-empty"><div class="lo-empty-ic">🗺️</div><div class="lo-empty-t">Aucune stratégie</div><div class="lo-empty-s">${STRAT_CANEDIT?'Clique « Nouvelle stratégie » pour en dessiner une.':'Les officiers n’ont pas encore préparé de stratégie.'}</div></div>`; return; }
  el.innerHTML='<div class="tl-cards">'+STRATS.map(s=>{
    const canE=stCanEdit(s); const btns=canE?`<div class="tl-cardact"><button class="lo-mini" data-stedit="${s.id}" title="Modifier">✎</button>${STRAT_CANEDIT?`<button class="lo-mini lo-minidel" data-stdel="${s.id}" title="Supprimer">✕</button>`:''}</div>`:"";
    const nst=(s.steps&&s.steps.length)||1; const meta=nst>1?`${nst} étapes`:`${(s.elements||[]).length} éléments`;
    return `<div class="tl-card st-card" data-stopen="${s.id}"><div class="st-card-map"><img src="maps/top/${esc(s.map||'')}.jpg" onerror="this.style.opacity='.12'"><span class="st-card-mapn">${esc(ST_MAPNAME[s.map]||prettyMap(s.map))}</span></div><div class="tl-card-h"><b>${esc(s.name||"Stratégie")}</b>${btns}</div><div class="tl-card-by">${meta} · par ${esc(s.created_by_name||"?")}</div></div>`;
  }).join("")+'</div>';
  el.querySelectorAll("[data-stopen]").forEach(c=>c.onclick=e=>{ if(e.target.closest("[data-stedit],[data-stdel]"))return; openStratView(STRATS.find(x=>String(x.id)===c.dataset.stopen)); });
  el.querySelectorAll("[data-stedit]").forEach(b=>b.onclick=e=>{e.stopPropagation();openStratEditor(STRATS.find(x=>String(x.id)===b.dataset.stedit));});
  el.querySelectorAll("[data-stdel]").forEach(b=>b.onclick=e=>{e.stopPropagation();deleteStrat(b.dataset.stdel);});
}
function openStratEditor(s, keepReplay){
  if(!stCanEdit(s)){ alert("Réservé aux officiers de combat et aux collaborateurs de cette stratégie."); return; }
  // Le REPLAY est une fonctionnalité à part (débriefing) : on le retire de l'éditeur
  // sauf si on vient justement de l'ouvrir via « Débriefer dans l'éditeur ».
  if(!keepReplay){ stRpStop(); ST_RP=null; }
  stChatStop(); stLeaveRoom();
  ST_EDIT={ id:(s&&s.id)||null, name:(s&&s.name)||"Nouvelle stratégie", map:(s&&s.map)||"", mode:(s&&s.mode)||"ctf", steps:stStepsOf(s), editors:(s&&Array.isArray(s.editors))?s.editors.map(Number):[],
            // bataille d'origine : c'est ce qui permet de RETROUVER le replay plus tard
            battleId:(s&&s.battle_id!=null)?String(s.battle_id):((keepReplay&&ST_RP)?String(ST_RP.battleId):null) };
  ST_STEP=0; ST_EDIT.els=ST_EDIT.steps[0].els;
  stSelClear(); ST_UNDO=[]; ST_REDO=[];
  if(!ST_EDIT.map) renderMapPicker(); else renderStratEditor();
  // Débrief enregistré rouvert depuis la liste : le replay n'est plus en mémoire,
  // on le recharge depuis la bataille puis on redessine.
  if(ST_EDIT.map && ST_EDIT.battleId && (!ST_RP || String(ST_RP.battleId)!==String(ST_EDIT.battleId))){
    const bid=ST_EDIT.battleId;
    stRpLoad(bid, ST_EDIT.map, ST_EDIT.name).then(ok=>{
      if(ok && ST_EDIT && String(ST_EDIT.battleId)===bid) renderStratEditor();
    });
  }
  if(ST_EDIT.id&&ST_EDIT.map) stJoinRoom(ST_EDIT.id,'edit');
  document.getElementById("stEditor").scrollIntoView({behavior:"smooth",block:"start"});
}
function renderMapPicker(){
  const ed=document.getElementById("stEditor"); ed.classList.remove("hidden");
  document.body.classList.toggle("st-noscroll", ST_FULL);
  ed.innerHTML=`<div class="card st-shell dashx st-editor${ST_FULL?' st-full':''}"><div class="st-bar"><b style="font-size:16px;font-weight:800;color:#ecebe8;flex:1">Choisis une carte</b><button class="st-x" id="stPickCancel" title="Annuler">✕</button></div>
    <div class="st-mapgrid">${ST_MAPS.map(m=>`<button type="button" class="st-mapopt" data-map="${m[0]}"><img src="maps/top/${m[0]}.jpg" onerror="this.style.opacity='.12'"><span>${esc(m[1])}</span></button>`).join("")}</div></div>`;
  document.getElementById("stPickCancel").onclick=()=>{ document.body.classList.remove("st-noscroll"); ed.classList.add("hidden"); ed.innerHTML=""; ST_EDIT=null; };
  ed.querySelectorAll(".st-mapopt").forEach(b=>b.onclick=()=>{ ST_EDIT.map=b.dataset.map; renderStratEditor(); });
}
function renderStratEditor(){
  const ed=document.getElementById("stEditor"); ed.classList.remove("hidden");
  ST_ZOOM={x:0,y:0,w:1000,h:1000};
  const KEYOF={}; Object.keys(ST_KEYS).forEach(k=>KEYOF[ST_KEYS[k]]=k.toUpperCase());
  const tools=ST_TOOLS.map(t=>`<button type="button" class="st-tool${ST_TOOL===t[0]?' on':''}" data-tool="${t[0]}" title="${t[1]}${KEYOF[t[0]]?' ('+KEYOF[t[0]]+')':''}"><span class="st-tool-ic"><svg viewBox="0 0 24 24">${ST_TOOL_ICONS[t[0]]||''}</svg></span><span class="st-tool-l">${t[1]}</span>${KEYOF[t[0]]?`<span class="st-tool-k">${KEYOF[t[0]]}</span>`:''}</button>`).join("");
  const colors=ST_COLORS.map(c=>`<button type="button" class="st-color${ST_COLOR===c?' on':''}" data-color="${c}" style="background:${c}"></button>`).join("");
  const modes=stModes(ST_EDIT.map); if(modes.length && !modes.includes(ST_EDIT.mode)) ST_EDIT.mode=modes[0];
  const modeSel=modes.length?`<label class="st-modewrap">Bases <select class="st-modesel" id="stMode" title="Mode de jeu (bases officielles)">${modes.map(mo=>`<option value="${mo}"${ST_EDIT.mode===mo?' selected':''}>${esc(ST_MODE_FR[mo]||mo)}</option>`).join("")}</select></label>`:'';
  const strokeGrp=`<div class="optgrp opt-stroke"><span class="opt-lbl">Trait</span><button type="button" class="st-sbtn${ST_STROKE.dash?' on':''}" id="stDash" title="Pointillés">┅</button><button type="button" class="st-sbtn opt-curve${ST_STROKE.curve?' on':''}" id="stCurve" title="Flèche courbe">⌒</button><span class="st-wsel">${[["thin",4],["med",7],["thick",12]].map(w=>`<button type="button" class="st-wbtn${ST_STROKE.w===w[1]?' on':''}" data-w="${w[1]}" title="Épaisseur"><i style="height:${Math.round(w[1]/2)+1}px"></i></button>`).join("")}</span></div>`;
  const colorGrp=`<div class="optgrp opt-colors"><span class="opt-lbl">Couleur</span>${colors}</div>`;
  const stampGrp=`<div class="optgrp opt-stamp"><span class="opt-lbl">Symbole</span>${ST_STAMP_LIST.map(([k,lbl])=>`<button type="button" class="st-stampb${ST_STAMP.kind===k?' on':''}" data-stamp="${k}" title="${esc(lbl)}"><svg viewBox="-20 -20 40 40" class="st-stamp-ic"><g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${ST_STAMPS[k]}</g></svg></button>`).join("")}<span class="st-opt-sep"></span><span class="opt-lbl">Taille</span><span class="st-szsel">${ST_STAMP_SIZES.map(([lbl,v])=>`<button type="button" class="st-szb${ST_STAMP.size===v?' on':''}" data-sz="${v}">${esc(lbl)}</button>`).join("")}</span></div>`;
  const tankGrp=`<div class="optgrp opt-tank"><div class="st-classsel" style="--tc:${ST_TANK.color}">${ST_CLASSES.map(c=>`<button type="button" class="st-class${ST_TANK.cls===c[0]?' on':''}" data-cls="${c[0]}" title="Char ${c[1]}"><span class="ic" style="-webkit-mask:url(strat/class_${c[0]}.png) center/contain no-repeat;mask:url(strat/class_${c[0]}.png) center/contain no-repeat"></span><span class="lbl">${c[1]}</span></button>`).join("")}</div><div class="st-tank-cols">${ST_TANK_COLORS.map(c=>`<button type="button" class="st-tcol${ST_TANK.color===c[0]?' on':''}" data-tcol="${c[0]}" title="${esc(c[1])}" style="background:${c[0]}"></button>`).join("")}</div><span class="st-opt-sep"></span><span class="opt-lbl">Taille</span><span class="st-szsel">${ST_TANK_SIZES.map(([lbl,v])=>`<button type="button" class="st-tkszb${ST_TANK.size===v?' on':''}" data-sz="${v}">${esc(lbl)}</button>`).join("")}</span><span class="st-opt-sep"></span><span class="opt-lbl">Formation</span><span class="st-szsel">${ST_FORMATIONS.map(([k,lbl])=>`<button type="button" class="st-formb" data-form="${k}" title="Déposer une formation ${esc(lbl)}">${esc(lbl)}</button>`).join("")}</span><div class="st-count" id="stCount"></div></div>`;
  const coneGrp=`<div class="optgrp opt-cone"><span class="opt-lbl">Ouverture</span><span class="st-szsel">${ST_CONE_SPREADS.map(([lbl,v])=>`<button type="button" class="st-coneb${ST_CONE.spread===v?' on':''}" data-cone="${v}">${esc(lbl)}</button>`).join("")}</span></div>`;
  const pathGrp=`<div class="optgrp opt-path"><span class="opt-lbl">Trajet</span><span class="st-opt-hint2">Clique pour ajouter des points · double-clic ou Entrée pour terminer</span></div>`;
  ed.innerHTML=`<div class="card st-shell dashx st-editor${ST_FULL?' st-full':''}">
    <div class="st-bar">
      <button class="st-x" id="stCancel" title="Fermer sans enregistrer">✕</button>
      <input class="st-name" id="stName" value="${esc(ST_EDIT.name)}" maxlength="80" placeholder="Nom de la stratégie">
      <div class="st-presence" id="stPresence"></div>
      <div class="st-bar-act">${modeSel}<button class="st-btn" id="stChangeMap" title="Changer de carte">🗺️ <span>Carte</span></button>${STRAT_CANEDIT?`<button class="st-btn" id="stCollab" title="Autoriser des membres à éditer">👥 <span>Collaborateurs</span></button>`:''}<button class="st-btn" id="stFull" title="Plein écran / fenêtré">⛶</button><button class="st-btn st-btn-gold" id="stPresent" title="Dérouler en présentation">▶ <span>Présenter</span></button><button class="st-btn st-btn-save" id="stSave">✓ Enregistrer</button></div>
    </div>
    <div class="st-work">
      <div class="st-rail">${tools}</div>
      <div class="st-canvas">
        <div class="st-opts" id="stOpts" data-tool="${ST_TOOL}">
          ${colorGrp}${strokeGrp}${tankGrp}${stampGrp}${coneGrp}${pathGrp}
          <span class="st-opt-hint" id="stOptHint"></span>
          <div class="st-opt-act"><button class="st-mini2" id="stUndo" title="Annuler (Ctrl+Z)">↶</button><button class="st-mini2" id="stRedo" title="Refaire (Ctrl+Y)">↷</button><button class="st-mini2${ST_GRID?' on':''}" id="stGridBtn" title="Grille A-K / 1-0">▦</button><button class="st-mini2${ST_SNAP?' on':''}" id="stSnapBtn" title="Aimantation à la grille">🧲</button><button class="st-mini2${ST_LASER?' on':''}" id="stLaserBtn" title="Pointeur : montrer sans dessiner (clic = ping). Visible par les collaborateurs.">🔴</button><span class="st-opt-sep"></span><button class="st-mini2" id="stFront" title="Passer au premier plan ( ] )">⬆</button><button class="st-mini2" id="stBack" title="Envoyer à l'arrière-plan ( [ )">⬇</button><button class="st-mini2" id="stDup" title="Dupliquer la sélection (Ctrl+D)">⧉</button><button class="st-mini2" id="stDelSel" title="Supprimer la sélection">🗑</button><button class="st-mini2" id="stClear" title="Tout effacer">Vider</button></div>
        </div>
        <div class="st-stage"><svg class="st-svg" id="stSvg" data-tool="${ST_TOOL}" viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg">
          <defs><marker id="st-ah" markerWidth="4.5" markerHeight="4.5" refX="3" refY="2.25" orient="auto"><path d="M0,0 L4.5,2.25 L0,4.5 z" fill="context-stroke"/></marker></defs>
          <image href="maps/top/${esc(ST_EDIT.map)}.jpg" x="0" y="0" width="1000" height="1000" preserveAspectRatio="none"/>
          <g id="stBases" style="pointer-events:none">${stBasesSvg(ST_EDIT.map,ST_EDIT.mode)}</g>
          <g id="stGrid" style="pointer-events:none">${ST_GRID?stGridInner():''}</g>
          <g id="stReplay" style="pointer-events:none"></g>
          <g id="stEls"></g><g id="stLaser" style="pointer-events:none"></g></svg>
          <div class="st-zoom"><button type="button" id="stZoomOut" title="Dézoomer (−)">−</button><button type="button" class="z-lvl" id="stZoomLvl" title="Réinitialiser le zoom">100%</button><button type="button" id="stZoomIn" title="Zoomer (+)">+</button></div>
          <div class="st-minimap" id="stMinimap" style="display:none" title="Mini-carte : clique ou glisse pour naviguer"><img src="maps/top/${esc(ST_EDIT.map)}.jpg" alt="" draggable="false"><div class="st-mini-vp" id="stMiniVp"></div></div></div>
      </div>
    </div>
    <div class="st-rp" id="stRpBar" style="display:none">
      <span class="st-rp-l">Replay</span>
      <button class="st-mini2" id="stRpPlay" title="Lecture / pause">▶</button>
      <button class="st-mini2" id="stRpBack" title="Reculer de 5 s">⏴</button>
      <button class="st-mini2" id="stRpFwd" title="Avancer de 5 s">⏵</button>
      <input class="st-rp-scrub" id="stRpScrub" type="range" min="0" max="100" step="0.1" value="0">
      <span class="st-rp-t" id="stRpTime">0:00</span>
      <select class="st-rp-spd" id="stRpSpeed" title="Vitesse"><option value="1">×1</option><option value="2" selected>×2</option><option value="4">×4</option><option value="8">×8</option></select>
      <button class="st-mini2 st-rp-pin" id="stRpPin" title="Créer une diapo de débriefing à cet instant">📌 Diapo ici</button>
      <button class="st-mini2 st-rp-prop" id="stRpProp" title="Proposer une position : clique un char du replay pour créer un fantôme « il aurait fallu être ici »">👥 Proposer</button>
      <span class="st-rp-name" id="stRpName"></span>
      <button class="st-mini2" id="stRpClose" title="Retirer le replay">✕</button>
    </div>
    <div class="st-steps2"><span class="st-steps2-l">Étapes</span><div class="st-steptabs" id="stStepTabs"></div><input class="st-stepnote" id="stStepNote" maxlength="140" placeholder="✎ Note de cette étape (affichée en présentation)…"><button class="st-mini2" id="stStepDel" title="Supprimer l'étape courante">🗑 Supprimer l'étape</button></div>
  </div>`;
  stRedraw();
  stWireEditor();
  stRpMount();
  stEnsureBases();   // sans attendre : le calque des bases se remplira au chargement
}
const ST_HINTS={select:"Clique un élément puis glisse pour le déplacer.",tank:"Choisis une couleur + une classe, puis clique sur la carte. Double-clic = nommer.",arrow:"Glisse pour tracer une flèche.",line:"Glisse pour tracer un trait.",rect:"Glisse pour dessiner une zone à surligner.",circle:"Glisse pour dessiner un cercle.",stamp:"Choisis un symbole tactique + une couleur, puis clique sur la carte.",measure:"Glisse d'un point à un autre : la distance s'affiche en mètres.",range:"Clique-glisse depuis un point : cercle de portée/vision en mètres.",cone:"Clique-glisse depuis un char : cône de tir orienté.",path:"Clique pour poser des points ; double-clic ou Entrée pour terminer le trajet.",pen:"Dessine à main levée.",marker:"Clique pour poser un jeton numéroté.",text:"Clique pour ajouter du texte.",erase:"Clique un élément pour l'effacer."};
function stSyncOptions(){ const o=document.getElementById("stOpts"); if(o) o.dataset.tool=ST_TOOL; const h=document.getElementById("stOptHint"); if(h) h.textContent=ST_HINTS[ST_TOOL]||""; }
function stTranslate(el,dx,dy){
  const c=JSON.parse(JSON.stringify(el));
  if(c.type==='arrow'||c.type==='line'||c.type==='rect'||c.type==='circle'||c.type==='measure'){ c.x1+=dx;c.y1+=dy;c.x2+=dx;c.y2+=dy; }
  else if(c.type==='pen'||c.type==='path'){ c.pts=c.pts.map(p=>[p[0]+dx,p[1]+dy]); }
  else { c.x+=dx; c.y+=dy; }
  return c;
}
// ---- sélection multiple, calques, presse-papier ----
function stSelClear(){ ST_SELS.clear(); }
function stSelEls(){ return [...ST_SELS].map(i=>ST_EDIT.els[i]).filter(Boolean); }
function stElBounds(el){
  if(el.type==='pen'||el.type==='path'){ const xs=el.pts.map(p=>p[0]),ys=el.pts.map(p=>p[1]); return [Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]; }
  if(el.x1!=null){ return [Math.min(el.x1,el.x2),Math.min(el.y1,el.y2),Math.max(el.x1,el.x2),Math.max(el.y1,el.y2)]; }
  if(el.type==='range'||el.type==='cone'){ const r=el.r||0; return [el.x-r,el.y-r,el.x+r,el.y+r]; }
  return [el.x-24,el.y-24,el.x+24,el.y+24];
}
function stDeleteSel(){ if(!ST_SELS.size)return; stSnapshot(); [...ST_SELS].sort((a,b)=>b-a).forEach(i=>ST_EDIT.els.splice(i,1)); stSelClear(); stRedraw(); stUpdCount(); }
function stDupSel(){ if(!ST_SELS.size)return; stSnapshot(); const copies=stSelEls().map(el=>stTranslate(el,30,30)); const start=ST_EDIT.els.length; copies.forEach(c=>ST_EDIT.els.push(c)); stSelClear(); copies.forEach((_,k)=>ST_SELS.add(start+k)); stRedraw(); stUpdCount(); }
function stZOrder(front){ if(!ST_SELS.size)return; stSnapshot(); const sel=stSelEls(); [...ST_SELS].sort((a,b)=>b-a).forEach(i=>ST_EDIT.els.splice(i,1)); stSelClear();
  if(front){ const start=ST_EDIT.els.length; sel.forEach(el=>ST_EDIT.els.push(el)); sel.forEach((_,k)=>ST_SELS.add(start+k)); }
  else { sel.slice().reverse().forEach(el=>ST_EDIT.els.unshift(el)); sel.forEach((_,k)=>ST_SELS.add(k)); }
  stRedraw(); }
function stNudge(dx,dy){ if(!ST_SELS.size)return; stSnapshot(); [...ST_SELS].forEach(i=>{ ST_EDIT.els[i]=stTranslate(ST_EDIT.els[i],dx,dy); }); stRedraw(); }
function stDropFormation(key){ const offs=ST_FORM_SHAPES[key]||ST_FORM_SHAPES.line;
  const cx=ST_ZOOM.x+ST_ZOOM.w/2, cy=ST_ZOOM.y+ST_ZOOM.h/2; stSnapshot(); stSelClear(); const start=ST_EDIT.els.length;
  offs.forEach(o=>ST_EDIT.els.push({type:'tank',cls:ST_TANK.cls,color:ST_TANK.color,x:Math.round(cx+o[0]),y:Math.round(cy+o[1]),name:'',size:ST_TANK.size}));
  offs.forEach((_,k)=>ST_SELS.add(start+k)); stRedraw(); stUpdCount(); }
function stCopy(){ ST_CLIP=stSelEls().map(el=>JSON.parse(JSON.stringify(el))); }
function stPaste(){ if(!ST_CLIP.length)return; stSnapshot(); const start=ST_EDIT.els.length; ST_CLIP.forEach(el=>ST_EDIT.els.push(stTranslate(JSON.parse(JSON.stringify(el)),42,42))); stSelClear(); ST_CLIP.forEach((_,k)=>ST_SELS.add(start+k)); stRedraw(); stUpdCount(); }
function stSelBoxSvg(){ if(!ST_BOX)return''; const x=Math.min(ST_BOX.x0,ST_BOX.x1),y=Math.min(ST_BOX.y0,ST_BOX.y1),w=Math.abs(ST_BOX.x1-ST_BOX.x0),h=Math.abs(ST_BOX.y1-ST_BOX.y0);
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#d8b25e" fill-opacity=".08" stroke="#d8b25e" stroke-width="2" stroke-dasharray="8 6" style="pointer-events:none"/>`; }
// ---- poignées de redimensionnement / rotation ----
function stScaleEl(el,f,cx,cy){ const c=JSON.parse(JSON.stringify(el)); f=Math.max(0.1,Math.min(6,f));
  const sp=(x,y)=>[cx+(x-cx)*f, cy+(y-cy)*f];
  if(c.x1!=null){ [c.x1,c.y1]=sp(c.x1,c.y1); [c.x2,c.y2]=sp(c.x2,c.y2); }
  else if(c.pts){ c.pts=c.pts.map(p=>sp(p[0],p[1])); }
  if(c.size!=null) c.size=Math.max(0.3,Math.min(3,(el.size||1)*f));
  if(c.type==='range'||c.type==='cone'){ c.r=Math.max(2,(el.r||1)*f); if(c.type==='range') c.m=Math.round(c.r/1000*stMapMeters()); }
  return c; }
function stHandlesSvg(){ if(ST_TOOL!=='select'||ST_SELS.size!==1||ST_BOX||ST_MOVE) return '';
  const i=[...ST_SELS][0]; const el=ST_EDIT.els[i]; if(!el) return '';
  let [x0,y0,x1,y1]=stElBounds(el); const cx=(x0+x1)/2, cy=(y0+y1)/2, pad=10;
  x0-=pad;y0-=pad;x1+=pad;y1+=pad; const rot=el.rot||0;
  const resizable=!['marker','text','measure'].includes(el.type);
  const ry=y0-40;
  let s=`<g class="st-handles" transform="rotate(${rot} ${cx} ${cy})" style="pointer-events:none">`;
  s+=`<rect x="${x0}" y="${y0}" width="${x1-x0}" height="${y1-y0}" fill="none" stroke="#e5b95c" stroke-width="2" stroke-dasharray="6 5" opacity=".85"/>`;
  if(resizable){ [['nw',x0,y0],['ne',x1,y0],['se',x1,y1],['sw',x0,y1]].forEach(c=>{ s+=`<circle class="st-handle" data-h="${c[0]}" cx="${c[1]}" cy="${c[2]}" r="9" fill="#15161a" stroke="#e5b95c" stroke-width="2.6" style="pointer-events:all;cursor:nwse-resize"/>`; }); }
  s+=`<line x1="${cx}" y1="${y0}" x2="${cx}" y2="${ry}" stroke="#e5b95c" stroke-width="2" opacity=".8"/><circle class="st-handle" data-h="rot" cx="${cx}" cy="${ry}" r="9" fill="#e5b95c" stroke="#0c0d0f" stroke-width="2.4" style="pointer-events:all;cursor:grab"/>`;
  return s+`</g>`; }
// ---- menu clic droit ----
function stHideCtxMenu(){ const m=document.getElementById("stCtxMenu"); if(m) m.remove(); }
function stShowCtxMenu(cx,cy,eid){
  stHideCtxMenu();
  const n=ST_SELS.size;
  const items = n ? [
    ["Copier","stCopy",!!n],
    ["Coller","stPaste",ST_CLIP.length>0],
    ["Dupliquer","stDupSel",!!n],
    ["sep"],
    ["Premier plan","stFront",!!n],
    ["Arrière-plan","stBack",!!n],
    ["sep"],
    ["Supprimer","stDelete",!!n],
  ] : [
    ["Coller","stPaste",ST_CLIP.length>0],
    ["Tout sélectionner","stAll",ST_EDIT.els.length>0],
  ];
  const m=document.createElement("div"); m.id="stCtxMenu"; m.className="st-ctxmenu";
  m.innerHTML=items.map(it=> it[0]==="sep"?`<div class="st-ctxsep"></div>`
    :`<button type="button" class="st-ctxitem${it[2]?'':' off'}" data-act="${it[1]}"${it[2]?'':' disabled'}>${it[0]}</button>`).join("");
  document.body.appendChild(m);
  const vw=innerWidth,vh=innerHeight,mw=m.offsetWidth||180,mh=m.offsetHeight||10;
  m.style.left=Math.min(cx,vw-mw-6)+"px"; m.style.top=Math.min(cy,vh-mh-6)+"px";
  m.querySelectorAll(".st-ctxitem").forEach(b=>b.onclick=()=>{ const a=b.dataset.act; stHideCtxMenu();
    if(a==='stCopy')stCopy(); else if(a==='stPaste')stPaste(); else if(a==='stDupSel')stDupSel();
    else if(a==='stFront')stZOrder(true); else if(a==='stBack')stZOrder(false);
    else if(a==='stDelete')stDeleteSel(); else if(a==='stAll'){ stSelClear(); ST_EDIT.els.forEach((_,i)=>ST_SELS.add(i)); stRedraw(); } });
  setTimeout(()=>{ document.addEventListener("pointerdown",stCtxOutside,true); },0);
}
function stCtxOutside(e){ const m=document.getElementById("stCtxMenu"); if(m&&!m.contains(e.target)){ stHideCtxMenu(); document.removeEventListener("pointerdown",stCtxOutside,true); } }
// Centre géométrique d'un élément (pour rotation/poignées).
function stElCenter(el){ const b=stElBounds(el); return [(b[0]+b[2])/2,(b[1]+b[3])/2]; }
// Wrapper : applique une rotation `rot` (deg) autour du centre si présente.
function stElSvg(el,i){ const s=stElInner(el,i); if(el.rot){ const c=stElCenter(el); return `<g transform="rotate(${el.rot} ${c[0]} ${c[1]})">${s}</g>`; } return s; }
function stElInner(el,i){
  const sel=ST_SELS.has(i)?' st-sel':'';
  if(el.type==='arrow'||el.type==='line'){ const w=el.w||7, m=el.type==='arrow'?' marker-end="url(#st-ah)"':'', dash=el.dash?` stroke-dasharray="${w*2.1} ${w*1.6}"`:'';
    if(el.curve) return `<path class="st-el${sel}" data-eid="${i}" d="${stCurvePath(el)}" fill="none" stroke="${esc(el.color)}" stroke-width="${w}" stroke-linecap="round"${dash}${m}/>`;
    return `<line class="st-el${sel}" data-eid="${i}" x1="${el.x1}" y1="${el.y1}" x2="${el.x2}" y2="${el.y2}" stroke="${esc(el.color)}" stroke-width="${w}" stroke-linecap="round"${dash}${m}/>`; }
  if(el.type==='rect'){ const x=Math.min(el.x1,el.x2),y=Math.min(el.y1,el.y2),w=Math.abs(el.x2-el.x1),h=Math.abs(el.y2-el.y1),sw=el.w||6,dash=el.dash?` stroke-dasharray="${sw*2.4} ${sw*1.8}"`:'';
    return `<rect class="st-el${sel}" data-eid="${i}" x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${esc(el.color)}" fill-opacity=".16" stroke="${esc(el.color)}" stroke-width="${sw}"${dash}/>`; }
  if(el.type==='circle'){ const cx=(el.x1+el.x2)/2,cy=(el.y1+el.y2)/2,rx=Math.abs(el.x2-el.x1)/2,ry=Math.abs(el.y2-el.y1)/2,sw=el.w||6,dash=el.dash?` stroke-dasharray="${sw*2.4} ${sw*1.8}"`:'';
    return `<ellipse class="st-el${sel}" data-eid="${i}" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${esc(el.color)}" fill-opacity=".16" stroke="${esc(el.color)}" stroke-width="${sw}"${dash}/>`; }
  if(el.type==='pen'){ const w=el.w||7, dash=el.dash?` stroke-dasharray="${w*2.1} ${w*1.6}"`:''; return `<polyline class="st-el${sel}" data-eid="${i}" points="${el.pts.map(p=>p.map(n=>Math.round(n)).join(',')).join(' ')}" fill="none" stroke="${esc(el.color)}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${dash}/>`; }
  if(el.type==='marker'){ return `<g class="st-el st-marker${sel}" data-eid="${i}"><circle cx="${el.x}" cy="${el.y}" r="24" fill="${esc(el.color)}" stroke="#0009" stroke-width="3"/><text x="${el.x}" y="${el.y+9}" font-size="26" font-weight="800" text-anchor="middle" fill="${stTextOn(el.color)}" style="pointer-events:none">${esc(el.label||'')}</text></g>`; }
  if(el.type==='text'){ return `<text class="st-el${sel}" data-eid="${i}" x="${el.x}" y="${el.y}" font-size="34" font-weight="800" fill="${esc(el.color)}" stroke="#000" stroke-width="1" paint-order="stroke">${esc(el.text||'')}</text>`; }
  // POSITION PROPOSÉE (débriefing) : fantôme relié par une flèche pointillée à la
  // position RÉELLE du char dans le replay (x0,y0 ne bougent jamais).
  if(el.type==='ghost'){ const col=el.color||'#d8b566'; const s=Math.round(66*(el.size||0.72)),h=s/2,
        cls=(ST_CLASSES.find(c=>c[0]===el.cls)?el.cls:'medium'), nm=String(el.name||'').trim();
    const arr=(el.x0!=null&&el.y0!=null)
      ? `<path d="M ${el.x0} ${el.y0} L ${el.x} ${el.y}" stroke="${esc(col)}" stroke-width="4" stroke-dasharray="11 8" fill="none" marker-end="url(#st-ah)" opacity=".9"/>`
        +`<circle cx="${el.x0}" cy="${el.y0}" r="6" fill="none" stroke="${esc(col)}" stroke-width="3" opacity=".75"/>` : '';
    const label=nm?`<text x="${el.x}" y="${el.y+h+11}" font-size="14" font-weight="700" text-anchor="middle" fill="#fff" stroke="#000" stroke-width="3" paint-order="stroke" style="pointer-events:none">${esc(nm)}</text>`:'';
    return `<g class="st-el st-ghost${sel}" data-eid="${i}">${arr}<filter id="stg${i}" x="-45%" y="-45%" width="190%" height="190%"><feFlood flood-color="${esc(col)}" result="f"/><feComposite in="f" in2="SourceAlpha" operator="in" result="s"/><feDropShadow in="s" dx="0" dy="0" stdDeviation="3" flood-color="#000" flood-opacity=".9"/></filter><image href="strat/class_${cls}.png" x="${el.x-h}" y="${el.y-h}" width="${s}" height="${s}" filter="url(#stg${i})" opacity=".7"/>${label}</g>`; }
  if(el.type==='tank'){ const col=el.color||'#5dbb46'; const s=Math.round(66*(el.size||0.78)),h=s/2, cls=(ST_CLASSES.find(c=>c[0]===el.cls)?el.cls:'medium');
    const nm=String(el.name||'').trim(); const nw=nm?Math.round(nm.length*8.6+16):0;
    const label=nm?`<g style="pointer-events:none"><rect x="${el.x-nw/2}" y="${el.y+h-6}" width="${nw}" height="21" rx="6" fill="#0c0d0f" fill-opacity=".82"/><text x="${el.x}" y="${el.y+h+9}" font-size="15" font-weight="700" text-anchor="middle" fill="#fff">${esc(nm)}</text></g>`:'';
    return `<g class="st-el st-tank${sel}" data-eid="${i}"><filter id="stk${i}" x="-45%" y="-45%" width="190%" height="190%"><feFlood flood-color="${esc(col)}" result="f"/><feComposite in="f" in2="SourceAlpha" operator="in" result="s"/><feDropShadow in="s" dx="0" dy="0" stdDeviation="3.4" flood-color="#000" flood-opacity=".92"/></filter><image href="strat/class_${cls}.png" x="${el.x-h}" y="${el.y-h}" width="${s}" height="${s}" filter="url(#stk${i})"/>${label}</g>`; }
  if(el.type==='stamp'){ const col=el.color||'#e5c84b', inner=ST_STAMPS[el.kind]||ST_STAMPS.focus, sz=el.size||0.75;
    return `<g class="st-el st-stamp${sel}" data-eid="${i}" transform="translate(${el.x},${el.y}) scale(${sz})"><circle r="20" fill="#0c0d0f" fill-opacity=".55" stroke="#0a0a0a" stroke-opacity=".45" stroke-width="2"/><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="color:${esc(col)}">${inner}</g></g>`; }
  if(el.type==='measure'){ const mx=Math.round((el.x1+el.x2)/2),my=Math.round((el.y1+el.y2)/2),tw=(String(el.m).length*9+30);
    return `<g class="st-el st-measure${sel}" data-eid="${i}"><line x1="${el.x1}" y1="${el.y1}" x2="${el.x2}" y2="${el.y2}" stroke="#f4d78c" stroke-width="3.4" stroke-dasharray="11 7" stroke-linecap="round"/><circle cx="${el.x1}" cy="${el.y1}" r="4.5" fill="#f4d78c"/><circle cx="${el.x2}" cy="${el.y2}" r="4.5" fill="#f4d78c"/><g style="pointer-events:none"><rect x="${mx-tw/2}" y="${my-13}" width="${tw}" height="23" rx="6" fill="#0c0d0f" fill-opacity=".88"/><text x="${mx}" y="${my+4}" font-size="15" font-weight="800" text-anchor="middle" fill="#f4d78c">${el.m} m</text></g></g>`; }
  if(el.type==='range'){ const col=el.color||'#5bb0e5', tw=(String(el.m).length*9+30);
    return `<g class="st-el st-range${sel}" data-eid="${i}"><circle cx="${el.x}" cy="${el.y}" r="${Math.round(el.r)}" fill="${esc(col)}" fill-opacity=".07" stroke="${esc(col)}" stroke-width="3" stroke-dasharray="10 8" style="pointer-events:none"/><circle cx="${el.x}" cy="${el.y}" r="6" fill="${esc(col)}"/><g style="pointer-events:none"><rect x="${el.x-tw/2}" y="${el.y-Math.round(el.r)-25}" width="${tw}" height="22" rx="6" fill="#0c0d0f" fill-opacity=".88"/><text x="${el.x}" y="${el.y-Math.round(el.r)-9}" font-size="14" font-weight="800" text-anchor="middle" fill="${esc(col)}">${el.m} m</text></g></g>`; }
  if(el.type==='cone'){ const col=el.color||'#e5c84b', r=Math.max(1,el.r||120), sp=Math.max(4,Math.min(160,el.spread||30));
    const a0=(el.a-sp)*Math.PI/180, a1=(el.a+sp)*Math.PI/180;
    const x0=el.x+r*Math.cos(a0), y0=el.y+r*Math.sin(a0), x1=el.x+r*Math.cos(a1), y1=el.y+r*Math.sin(a1), large=(2*sp)>180?1:0;
    return `<g class="st-el st-cone${sel}" data-eid="${i}"><path d="M ${el.x} ${el.y} L ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z" fill="${esc(col)}" fill-opacity=".16" stroke="${esc(col)}" stroke-width="2.5" stroke-linejoin="round"/><circle cx="${el.x}" cy="${el.y}" r="6" fill="${esc(col)}"/></g>`; }
  if(el.type==='path'){ const w=el.w||7, dash=el.dash?` stroke-dasharray="${w*2.1} ${w*1.6}"`:'', pts=el.pts||[];
    if(pts.length<2) return '';
    const dots=pts.map(p=>`<circle cx="${p[0]}" cy="${p[1]}" r="${w*0.7+1}" fill="${esc(el.color)}" style="pointer-events:none"/>`).join("");
    return `<g class="st-el st-path${sel}" data-eid="${i}"><polyline points="${pts.map(p=>p.map(n=>Math.round(n)).join(',')).join(' ')}" fill="none" stroke="${esc(el.color)}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${dash} marker-end="url(#st-ah)"/>${dots}</g>`; }
  return '';
}
function stDrawPreview(){ let s='';
  if(ST_PATHBUILD){ const b=ST_PATHBUILD, w=b.w||7; const pts=b.cursor?b.pts.concat([b.cursor]):b.pts;
    s+=`<g opacity=".9" style="pointer-events:none"><polyline points="${pts.map(p=>p.map(n=>Math.round(n)).join(',')).join(' ')}" fill="none" stroke="${esc(b.color)}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="2 ${w*1.7}" marker-end="url(#st-ah)"/>${b.pts.map(p=>`<circle cx="${p[0]}" cy="${p[1]}" r="${w*0.7+1}" fill="${esc(b.color)}"/>`).join('')}</g>`; }
  const d=ST_DRAW; if(d && !(d.type==='pen'&&d.pts.length<2)) s+=`<g opacity=".8" style="pointer-events:none">${stElSvg(d,'prev')}</g>`;
  return s; }
// Termine (ou annule) un trajet multipoint en cours.
function stFinishPath(commit){ const b=ST_PATHBUILD; ST_PATHBUILD=null;
  if(commit&&b){ const pts=b.pts.filter((p,i)=> i===0 || Math.hypot(p[0]-b.pts[i-1][0],p[1]-b.pts[i-1][1])>4 );
    if(pts.length>1){ stSnapshot(); ST_EDIT.els.push({type:'path',color:b.color,w:b.w,dash:b.dash,pts}); } }
  stRedraw(); }
/* ============================================================
   REPLAY DANS L'ÉDITEUR  (débriefing)
   Couche EN LECTURE SEULE : les chars sont placés d'après le replay
   enregistré par le mod. Les annotations restent des éléments normaux
   de l'étape courante -> remettre "play" ne les déplace jamais.
   ============================================================ */
let ST_RP=null;            // {battleId,name,dur,interval,bounds,vehicles,t,playing,speed,raf,last}
const ST_RP_CLS={heavyTank:"heavy", mediumTank:"medium", lightTank:"light", "AT-SPG":"td", SPG:"spg"};
const ST_RP_ICON=42;       // taille du char sur la carte (repère 0-1000)

function stRpFmt(s){ s=Math.max(0,Math.floor(s)); return Math.floor(s/60)+":"+String(s%60).padStart(2,"0"); }
/* Étiquette d'un char sur la carte : le NOM DU CHAR (raccourci), pas le pseudo.
   Ex. « 60TP Lewandowskiego » -> « 60TP ». Repli sur le pseudo si le mod n'a pas
   envoyé le char (anciens replays). */
/* Étiquette d'un char sur la carte : le nom du char TEL QUEL.
   Le mod enregistre `shortUserString`, c'est-à-dire l'abréviation OFFICIELLE de
   Wargaming (« 60TP », « Obj. 260 », « AMX 50 B »…). Mesuré sur les 378 chars de
   rang X et VIII : longueur maximale 14 caractères. Il n'y a donc rien à
   raccourcir, et toute tentative recree des confusions — « Obj. 140 CL » -> « Obj. 140 »
   (deja pris), « AMX 50 B » -> « AMX 50 » (confondu avec AMX 50 100), etc.
   Le plafond ci-dessous ne sert qu'au repli rare ou le mod n'a trouve que
   `userString` (nom long) faute de `shortUserString`. */
function stRpLabel(v){
  const s=String(v.tank||"").trim();
  if(!s) return String(v.name||"");          // anciens replays : repli sur le pseudo
  return s.length>18 ? s.slice(0,18)+"…" : s;
}
/* monde -> repère 0-1000 de l'éditeur (les bornes du replay font autorité) */
function stRpXY(x,z){ const b=ST_RP.bounds;
  return [ (x-b.minX)/((b.maxX-b.minX)||1)*1000, (b.maxZ-z)/((b.maxZ-b.minZ)||1)*1000 ]; }
/* position + état de repérage d'un char à l'instant t (mêmes règles que le lecteur) */
function stRpPos(v,time){
  const tr=v.track; if(!tr||!tr.length) return null;
  const GAP=Math.max(2,(ST_RP.interval||2)*1.6);
  if(v.deathT!=null && time>=v.deathT){
    let p=tr[0]; for(let i=0;i<tr.length;i++){ if(tr[i][0]<=v.deathT) p=tr[i]; else break; }
    return {x:p[1],z:p[2],dead:true,spotted:true,yaw:(p.length>3?p[3]:null)};
  }
  if(time<tr[0][0]) return null;
  let lo=null,hi=null;
  for(let i=0;i<tr.length;i++){ if(tr[i][0]<=time) lo=tr[i]; else { hi=tr[i]; break; } }
  if(!lo) return null;
  const yaw=(lo.length>3?lo[3]:null);
  if(hi && (hi[0]-lo[0])<=GAP){ const f=(time-lo[0])/((hi[0]-lo[0])||1);
    return {x:lo[1]+(hi[1]-lo[1])*f, z:lo[2]+(hi[2]-lo[2])*f, dead:false, spotted:true, yaw}; }
  return {x:lo[1], z:lo[2], dead:false, spotted:((time-lo[0])<=GAP), yaw};
}
/* dessine la couche replay dans le SVG de l'éditeur */
function stRpDraw(gid){
  const g=document.getElementById(gid||"stReplay"); if(!g) return;
  if(!ST_RP){ g.innerHTML=""; return; }
  const t=ST_RP.t, R=ST_RP_ICON, h=R/2, out=[];
  // Filtres de teinte : la silhouette de l'icône est repeinte aux couleurs de
  // l'équipe (feFlood + feComposite sur l'alpha), avec une ombre pour rester
  // lisible sur les cartes claires.
  // id préfixé par le calque : l'éditeur et la présentation coexistent dans le DOM
  // et des ids dupliqués feraient résoudre url(#…) sur le mauvais filtre.
  const FID=(gid||"stReplay")+"_";
  out.push(`<defs>${[[FID+"rpTintA","#2ec26e"],[FID+"rpTintE","#ec6a6a"]].map(([id,c])=>
    `<filter id="${id}" x="-40%" y="-40%" width="180%" height="180%">
       <feFlood flood-color="${c}"/><feComposite in2="SourceAlpha" operator="in"/>
       <feDropShadow dx="0" dy="0" stdDeviation="1.1" flood-color="#000" flood-opacity="1"/>
     </filter>`).join("")}</defs>`);
  // mode « proposer » : uniquement dans l'éditeur, jamais en présentation
  const pick=!!ST_RP.propose && (!gid || gid==="stReplay");
  ST_RP.vehicles.forEach((v,vi)=>{
    const p=stRpPos(v,t); if(!p) return;
    const xy=stRpXY(p.x,p.z), x=xy[0], y=xy[1];
    const col=v.ally?"#2ec26e":"#ec6a6a";
    const op=p.spotted?1:0.32;
    const at=pick?` class="rp-pick" data-vi="${vi}" style="pointer-events:auto;cursor:copy"`:"";
    if(p.dead){
      out.push(`<g opacity="${op*0.6}"${at}><path d="M${x-9} ${y-9} L${x+9} ${y+9} M${x+9} ${y-9} L${x-9} ${y+9}" stroke="${col}" stroke-width="4" stroke-linecap="round" fill="none"/></g>`);
      return;
    }
    let s=`<g opacity="${op}"${at}>`;
    if(p.yaw!=null){   // cône de visée, discret
      const rad=p.yaw*Math.PI/180, L=64, half=13*Math.PI/180;
      const a=Math.atan2(-Math.cos(rad),Math.sin(rad));
      const x1=x+Math.cos(a-half)*L, y1=y+Math.sin(a-half)*L, x2=x+Math.cos(a+half)*L, y2=y+Math.sin(a+half)*L;
      s+=`<path d="M${x.toFixed(1)} ${y.toFixed(1)} L${x1.toFixed(1)} ${y1.toFixed(1)} A${L} ${L} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${col}" opacity=".16"/>`;
    }
    const ic=ST_RP_CLS[v.cls];
    if(ic) s+=`<image href="strat/class_${ic}.png" x="${(x-h).toFixed(1)}" y="${(y-h).toFixed(1)}" width="${R}" height="${R}" filter="url(#${FID}${v.ally?'rpTintA':'rpTintE'})"/>`
             +`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(h*0.86).toFixed(1)}" fill="none" stroke="${col}" stroke-width="2" opacity=".55"/>`;
    else s+=`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="10" fill="${col}" stroke="#000" stroke-width="2"/>`;
    s+=`<text x="${x.toFixed(1)}" y="${(y+h+13).toFixed(1)}" text-anchor="middle" font-size="15" font-weight="700" fill="#fff" stroke="#000" stroke-width="3" paint-order="stroke" style="pointer-events:none">${esc(stRpLabel(v))}</text>`;
    out.push(s+`</g>`);
  });
  g.innerHTML=out.join("");
  g.style.pointerEvents = pick ? "auto" : "none";
  if(pick) g.onpointerdown=stRpPick; else g.onpointerdown=null;
}
/* Clic sur un char du replay en mode « proposer » : crée une POSITION PROPOSÉE
   (fantôme) décalée, reliée par une flèche à la position réelle. Le replay n'est
   jamais modifié : on ne fait qu'ajouter une annotation à la diapo courante. */
function stRpPick(ev){
  const gEl=ev.target.closest && ev.target.closest(".rp-pick");
  if(!gEl||!ST_RP||!ST_EDIT) return;
  ev.stopPropagation(); ev.preventDefault();
  const v=ST_RP.vehicles[+gEl.dataset.vi]; if(!v) return;
  const p=stRpPos(v,ST_RP.t); if(!p) return;
  const xy=stRpXY(p.x,p.z);
  if(typeof stSnapshot==='function') stSnapshot();
  ST_EDIT.els.push({ type:'ghost', x0:Math.round(xy[0]), y0:Math.round(xy[1]),
    x:Math.round(xy[0])+80, y:Math.round(xy[1]), cls:(ST_RP_CLS[v.cls]||'medium'),
    color:'#d8b566', name:stRpLabel(v).slice(0,18), size:0.72 });
  stRedraw(); if(typeof stUpdCount==='function') stUpdCount();
}
function stRpSync(){
  const sc=document.getElementById("stRpScrub"), tm=document.getElementById("stRpTime"),
        pb=document.getElementById("stRpPlay");
  if(sc) sc.value=ST_RP?ST_RP.t:0;
  if(tm) tm.textContent=ST_RP?(stRpFmt(ST_RP.t)+" / "+stRpFmt(ST_RP.dur)):"0:00";
  if(pb) pb.textContent=(ST_RP&&ST_RP.playing)?"❚❚":"▶";
}
function stRpStop(){ if(ST_RP&&ST_RP.raf){ cancelAnimationFrame(ST_RP.raf); ST_RP.raf=null; } if(ST_RP) ST_RP.playing=false; stRpSync(); }
function stRpLoop(now){
  if(!ST_RP||!ST_RP.playing) return;
  const dt=(now-ST_RP.last)/1000; ST_RP.last=now;
  ST_RP.t=Math.min(ST_RP.dur, ST_RP.t+dt*ST_RP.speed);
  if(ST_RP.t>=ST_RP.dur){ ST_RP.t=ST_RP.dur; ST_RP.playing=false; }
  stRpDraw(); stRpSync(); stRpFollowSteps();
  if(ST_RP.playing) ST_RP.raf=requestAnimationFrame(stRpLoop);
}
function stRpSeek(nt){ if(!ST_RP) return; ST_RP.t=Math.max(0,Math.min(ST_RP.dur,nt)); stRpDraw(); stRpSync(); stRpFollowSteps(); }
/* ---- Diapos de débriefing épinglées à un instant du replay ----
   « Pause = tableau blanc » : on met en pause où l'on veut, on épingle une diapo,
   on annote. En lecture, la diapo correspondante s'affiche à son instant. */
function stRpPinStep(){
  if(!ST_RP||!ST_EDIT) return;
  const t=Math.round(ST_RP.t*10)/10, cur=ST_EDIT.steps[ST_STEP];
  stRpStop();
  // 1re diapo encore vierge et non épinglée -> on l'épingle ici au lieu d'en créer une
  if(cur && cur.t==null && !(cur.els||[]).length){ cur.t=t; }
  else {
    if(ST_EDIT.steps.length>=12){ alert("Maximum 12 diapos."); return; }
    ST_EDIT.steps.splice(ST_STEP+1,0,{els:[],note:"",t:t});
    ST_STEP++; ST_EDIT.els=ST_EDIT.steps[ST_STEP].els;
    stSelClear(); ST_UNDO=[]; ST_REDO=[];
  }
  // les diapos restent dans l'ordre chronologique
  const keep=ST_EDIT.steps[ST_STEP];
  ST_EDIT.steps.sort((a,b)=>((a.t==null?-1:a.t)-(b.t==null?-1:b.t)));
  ST_STEP=Math.max(0,ST_EDIT.steps.indexOf(keep));
  ST_EDIT.els=ST_EDIT.steps[ST_STEP].els;
  renderStepTabs(); stRedraw(); if(typeof stUpdCount==='function') stUpdCount();
}
/* pendant la lecture : afficher la diapo correspondant à l'instant courant.
   AVANT la première diapo épinglée, aucune annotation ne doit apparaître. */
let ST_RP_BLANK=false;
function stRpFollowSteps(){
  if(!ST_RP||!ST_EDIT||!ST_EDIT.steps) return;
  if(!ST_EDIT.steps.some(s=>s.t!=null)) return;      // aucune diapo épinglée : on ne touche à rien
  let idx=-1;
  ST_EDIT.steps.forEach((s,i)=>{ if(s.t!=null && s.t<=ST_RP.t+0.001) idx=i; });
  if(idx<0){                                          // on est avant la 1re diapo
    if(!ST_RP_BLANK){ const g=document.getElementById("stEls"); if(g) g.innerHTML=""; ST_RP_BLANK=true; }
    return;
  }
  if(idx!==ST_STEP){ ST_RP_BLANK=false; stGoStep(idx); }
  else if(ST_RP_BLANK){ ST_RP_BLANK=false; stRedraw(); }
}
/* (re)branche la barre après chaque rendu de l'éditeur */
function stRpMount(){
  const bar=document.getElementById("stRpBar"); if(!bar) return;
  if(!ST_RP){ bar.style.display="none"; return; }
  bar.style.display="flex";
  const sc=document.getElementById("stRpScrub");
  sc.max=ST_RP.dur; sc.value=ST_RP.t;
  document.getElementById("stRpName").textContent=ST_RP.name||"";
  document.getElementById("stRpSpeed").value=String(ST_RP.speed);
  document.getElementById("stRpPlay").onclick=()=>{
    if(!ST_RP) return;
    if(ST_RP.playing){ stRpStop(); }
    else { if(ST_RP.t>=ST_RP.dur) ST_RP.t=0; ST_RP.playing=true; ST_RP.last=performance.now(); ST_RP.raf=requestAnimationFrame(stRpLoop); stRpSync(); }
  };
  document.getElementById("stRpBack").onclick=()=>{ stRpStop(); stRpSeek(ST_RP.t-5); };
  document.getElementById("stRpFwd").onclick =()=>{ stRpStop(); stRpSeek(ST_RP.t+5); };
  // ⚠️ lire la valeur AVANT stRpStop() : celui-ci resynchronise le curseur sur ST_RP.t
  sc.oninput=()=>{ const v=+sc.value; stRpStop(); stRpSeek(v); };
  document.getElementById("stRpSpeed").onchange=e=>{ ST_RP.speed=+e.target.value; };
  document.getElementById("stRpPin").onclick=stRpPinStep;
  const pb2=document.getElementById("stRpProp");
  pb2.classList.toggle("on", !!ST_RP.propose);
  pb2.onclick=()=>{ ST_RP.propose=!ST_RP.propose; pb2.classList.toggle("on",ST_RP.propose); stRpDraw(); };
  document.getElementById("stRpClose").onclick=()=>{ stRpStop(); ST_RP=null; stRpDraw(); stRpMount(); };
  stRpDraw(); stRpSync();
}
/* Point d'entrée : ouvre le replay d'une bataille dans l'éditeur */
/* Charge le replay d'une bataille dans ST_RP. Utilisé par le bouton « Débriefer »
   ET à la réouverture d'un débrief enregistré (où l'onglet Batailles n'a pas
   forcément été chargé : on ne peut donc PAS dépendre de BL_BY_ID). */
async function stRpLoad(battleId, mapK, label){
  let rep=null;
  try{
    const r=await fnCall("replay",{session:localStorage.getItem(LS_SESSION), battle_id:battleId});
    if(r.ok && r.j && r.j.replay && (r.j.replay.vehicles||[]).length) rep=convertReplay(r.j.replay);
  }catch(e){}
  if(!rep) return false;
  ST_RP={ battleId:String(battleId), name:label||"", map:mapK,
          dur:rep.duration||0, interval:rep.interval||2, bounds:rep.bounds, vehicles:rep.vehicles,
          bases:rep.bases||[],
          t:0, playing:false, speed:2, raf:null, last:0 };
  return true;
}
async function stOpenReplay(battleId, btn){
  const g=BL_BY_ID[battleId]; if(!g) return;
  if(btn){ btn.disabled=true; btn.textContent="Chargement…"; }
  const ok=await stRpLoad(g.id, mapKey(g.mapName), pretty2(g.mapName)+" · "+agoFR(g.ts));
  if(btn){ btn.disabled=false; btn.innerHTML='✎ Débriefer dans l\'éditeur'; }
  if(!ok){ alert("Aucun replay enregistré pour cette bataille."); return; }
  // L'éditeur vit DANS l'onglet Stratégie : il faut y basculer, sinon il s'ouvre
  // dans un conteneur masqué (la vue Batailles semblait alors se figer).
  try{ switchView("strats"); }catch(e){}
  openStratEditor({ name:"Débrief — "+ST_RP.name, map:mapKey(g.mapName), mode:"ctf" }, true);
}
function pretty2(s){ try{ return pretty(mapKey(s)); }catch(e){ return String(s||""); } }

function stRedraw(){ const g=document.getElementById("stEls"); if(g) g.innerHTML=ST_EDIT.els.map((e,i)=>stElSvg(e,i)).join("")+stDrawPreview()+stSelBoxSvg()+stHandlesSvg(); }
// Métriques du canvas : le viewBox (carré) est centré dans l'élément SVG (letterbox
// via preserveAspectRatio "meet"), donc échelle = plus petite dimension / côté du viewBox.
function stMetrics(svg){ const r=svg.getBoundingClientRect(); const s=Math.min(r.width,r.height)/ST_ZOOM.w||1;
  return {r, s, offX:(r.width-ST_ZOOM.w*s)/2, offY:(r.height-ST_ZOOM.h*s)/2}; }
function stPt(e,svg){ const m=stMetrics(svg);
  const vx=ST_ZOOM.x+(e.clientX-m.r.left-m.offX)/m.s, vy=ST_ZOOM.y+(e.clientY-m.r.top-m.offY)/m.s;
  return [Math.max(0,Math.min(1000,vx)),Math.max(0,Math.min(1000,vy))]; }
/* ============================================================
   POINTEUR (laser) DANS L'ÉDITEUR
   Montrer sans dessiner, hors mode présentation. Purement visuel : rien n'est
   ajouté aux éléments de la stratégie. Si une session collaborative est ouverte,
   le pointeur est diffusé aux autres éditeurs (événement 'ptr').
   ============================================================ */
let ST_LASER=false;
const ST_PTRS={};                 // pointeurs DISTANTS : id -> {x,y,name,ts}
let ST_PTR_LAST=0;                // limitation du débit de diffusion
const ST_PTR_TTL=3000;            // un pointeur distant inactif disparaît

const ST_TR_MS=420;               // durée de vie d'un point de traînée
/* Traînée : les points récents reliés par une courbe lissée (passage par les
   milieux de segments), découpée en tronçons dont l'opacité et l'épaisseur
   décroissent avec l'âge. C'est ce dégradé par tronçon qui donne la fluidité —
   un simple polyline donnerait un trait raide et uniforme. */
function stTrailSvg(tr,c,now){
  if(!tr||tr.length<2) return "";
  let s="";
  for(let i=1;i<tr.length;i++){
    const a=tr[i-1], b=tr[i];
    const age=(now-b.t)/ST_TR_MS; if(age>=1) continue;
    const k=1-age;                                     // 1 = tout frais, 0 = éteint
    const mx=(a.x+b.x)/2, my=(a.y+b.y)/2;
    s+=`<path d="M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${a.x.toFixed(1)} ${a.y.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)} T${b.x.toFixed(1)} ${b.y.toFixed(1)}" fill="none" stroke="${c}" stroke-opacity="${(k*0.55).toFixed(3)}" stroke-width="${(2+k*7).toFixed(2)}" stroke-linecap="round"/>`;
  }
  return s;
}
function stTrailPush(tr,x,y,now){
  const last=tr[tr.length-1];
  if(last && Math.hypot(x-last.x,y-last.y)<1.5){ last.t=now; return; }   // évite les doublons à l'arrêt
  tr.push({x,y,t:now});
  while(tr.length && now-tr[0].t>ST_TR_MS) tr.shift();
  if(tr.length>40) tr.shift();
}
function stLaserDot(x,y,name,mine){
  const c=mine?"#ff3b3b":"#4ea1ff";
  return `<circle cx="${x}" cy="${y}" r="13" fill="${c}" fill-opacity=".26"/>`
       + `<circle cx="${x}" cy="${y}" r="6" fill="${c}"/>`
       + `<circle cx="${x}" cy="${y}" r="6" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="1.4"/>`
       + (name?`<text x="${x+14}" y="${y-10}" font-size="15" font-weight="700" fill="#fff" stroke="#000" stroke-width="3" paint-order="stroke">${esc(name)}</text>`:"");
}
function stLaserRedraw(){
  const g=document.getElementById("stLaser"); if(!g) return;
  const now=Date.now(); let s="", vivant=false;
  // les traînées passent SOUS les points, sinon elles masqueraient le pointeur
  if(ST_LASER){ while(ST_LASER_TR.length && now-ST_LASER_TR[0].t>ST_TR_MS) ST_LASER_TR.shift();
    if(ST_LASER_TR.length>1){ s+=stTrailSvg(ST_LASER_TR,"#ff3b3b",now); vivant=true; } }
  Object.keys(ST_PTRS).forEach(k=>{ const p=ST_PTRS[k];
    if(now-p.ts>ST_PTR_TTL){ delete ST_PTRS[k]; return; }
    while(p.tr.length && now-p.tr[0].t>ST_TR_MS) p.tr.shift();
    if(p.tr.length>1){ s+=stTrailSvg(p.tr,"#4ea1ff",now); vivant=true; } });
  if(ST_LASER && ST_LASER_P) s+=stLaserDot(ST_LASER_P[0].toFixed(1),ST_LASER_P[1].toFixed(1),"",true);
  Object.keys(ST_PTRS).forEach(k=>{ const p=ST_PTRS[k];
    s+=stLaserDot(p.x.toFixed(1),p.y.toFixed(1),p.name||"",false); });
  g.innerHTML=s;
  // Tant qu'une traînée s'estompe, on continue d'animer même si la souris ne
  // bouge plus — sinon la queue resterait figée à l'écran.
  if(vivant){ if(!ST_TR_RAF) ST_TR_RAF=requestAnimationFrame(()=>{ ST_TR_RAF=0; stLaserRedraw(); }); }
}
let ST_LASER_P=null, ST_LASER_TR=[], ST_TR_RAF=0;
function stLaserMove(p){
  ST_LASER_P=p; stTrailPush(ST_LASER_TR,p[0],p[1],Date.now()); stLaserRedraw();
  const now=Date.now();                                  // ~20 envois/s maximum
  if(ST_ROOM && now-ST_PTR_LAST>50){ ST_PTR_LAST=now;
    try{ ST_ROOM.send({type:'broadcast',event:'ptr',payload:{by:STRAT_ME,name:stMyName(),x:p[0],y:p[1]}}); }catch(_){} }
}
function stLaserPing(p){
  const g=document.getElementById("stLaser"); if(!g) return;
  const c=document.createElementNS("http://www.w3.org/2000/svg","circle");
  c.setAttribute("cx",p[0]); c.setAttribute("cy",p[1]); c.setAttribute("r","6");
  c.setAttribute("fill","none"); c.setAttribute("stroke","#ff3b3b"); c.setAttribute("stroke-width","3");
  c.style.transition="all .5s ease-out"; g.appendChild(c);
  requestAnimationFrame(()=>{ c.setAttribute("r","46"); c.style.opacity="0"; });
  setTimeout(()=>c.remove(),520);
  if(ST_ROOM){ try{ ST_ROOM.send({type:'broadcast',event:'ptr',payload:{by:STRAT_ME,name:stMyName(),x:p[0],y:p[1],ping:true}}); }catch(_){} }
}
// pointeur reçu d'un collaborateur
function stPtrRemote(pl){
  if(!pl||pl.by===STRAT_ME) return;
  const k=String(pl.by), now=Date.now();
  const cur=ST_PTRS[k] || (ST_PTRS[k]={ x:0, y:0, name:"", ts:now, tr:[] });
  cur.x=Number(pl.x)||0; cur.y=Number(pl.y)||0; cur.name=String(pl.name||pl.by||""); cur.ts=now;
  stTrailPush(cur.tr,cur.x,cur.y,now);                 // même traînée pour les collaborateurs
  stLaserRedraw();
  if(pl.ping) stLaserPing([Number(pl.x)||0,Number(pl.y)||0]);
  // sans balayage, un pointeur distant resterait affiché après le départ du collaborateur
  if(!ST_PTR_SWEEP) ST_PTR_SWEEP=setInterval(()=>{
    const n=Object.keys(ST_PTRS).length; stLaserRedraw();
    if(n===0){ clearInterval(ST_PTR_SWEEP); ST_PTR_SWEEP=0; }
  },1000);
}
let ST_PTR_SWEEP=0;
function stLaserToggle(){
  ST_LASER=!ST_LASER; ST_LASER_P=null; ST_LASER_TR=[];
  const b=document.getElementById("stLaserBtn"), sv=document.getElementById("stSvg");
  if(b) b.classList.toggle("on",ST_LASER);
  if(sv) sv.classList.toggle("st-laser-on",ST_LASER);
  stLaserRedraw();
}

function stNextMarkerLabel(){ let n=0; ST_EDIT.els.forEach(e=>{ if(e.type==='marker'){ const v=parseInt(e.label,10); if(!isNaN(v)&&v>n) n=v; } }); return String(n+1); }
// -- historique annuler / refaire --
function stSnapshot(){ if(!ST_EDIT) return; ST_UNDO.push(JSON.stringify(ST_EDIT.els)); if(ST_UNDO.length>80) ST_UNDO.shift(); ST_REDO.length=0; stUpdUndoBtns(); }
function stSetEls(a){ ST_EDIT.els=a; if(ST_EDIT.steps&&ST_EDIT.steps[ST_STEP]) ST_EDIT.steps[ST_STEP].els=a; }
function stUndo(){ if(!ST_UNDO.length) return; ST_REDO.push(JSON.stringify(ST_EDIT.els)); stSetEls(JSON.parse(ST_UNDO.pop())); stSelClear(); stRedraw(); stUpdCount(); stUpdUndoBtns(); }
function stRedo(){ if(!ST_REDO.length) return; ST_UNDO.push(JSON.stringify(ST_EDIT.els)); stSetEls(JSON.parse(ST_REDO.pop())); stSelClear(); stRedraw(); stUpdCount(); stUpdUndoBtns(); }
// -- étapes (slideshow) --
function renderStepTabs(){ const c=document.getElementById("stStepTabs"); if(!c||!ST_EDIT.steps) return;
  c.innerHTML=ST_EDIT.steps.map((st,i)=>{
    const t=(st.t!=null)?stRpFmt(st.t):null;    // diapo épinglée à un instant du replay
    return `<button type="button" class="st-steptab${i===ST_STEP?' on':''}" data-step="${i}" title="Étape ${i+1}${t?" — épinglée à "+t:""}">${i+1}${t?`<span class="tt">${t}</span>`:""}</button>`;
  }).join("")+(ST_EDIT.steps.length<12?`<button type="button" class="st-stepadd" id="stStepAdd" title="Ajouter une étape (copie l'étape actuelle)">+</button>`:'');
  c.querySelectorAll(".st-steptab").forEach(b=>b.onclick=()=>stGoStep(+b.dataset.step));
  const add=c.querySelector("#stStepAdd"); if(add) add.onclick=stAddStep; stSyncNote(); }
function stSyncNote(){ const inp=document.getElementById("stStepNote"); if(inp&&ST_EDIT&&ST_EDIT.steps&&ST_EDIT.steps[ST_STEP]) inp.value=ST_EDIT.steps[ST_STEP].note||''; }
function stGoStep(i){ if(!ST_EDIT.steps||i<0||i>=ST_EDIT.steps.length||i===ST_STEP) return; ST_STEP=i; ST_EDIT.els=ST_EDIT.steps[i].els; stSelClear(); ST_UNDO=[]; ST_REDO=[]; renderStepTabs(); stRedraw(); stUpdCount(); stUpdUndoBtns(); }
function stAddStep(){ if(ST_EDIT.steps.length>=12){ alert("Maximum 12 étapes."); return; } ST_EDIT.steps.splice(ST_STEP+1,0,{els:JSON.parse(JSON.stringify(ST_EDIT.els))}); ST_STEP++; ST_EDIT.els=ST_EDIT.steps[ST_STEP].els; stSelClear(); ST_UNDO=[]; ST_REDO=[]; renderStepTabs(); stRedraw(); stUpdCount(); stUpdUndoBtns(); }
function stDelStep(){ if(ST_EDIT.steps.length<=1){ alert("Il faut au moins une étape."); return; } if(!confirm("Supprimer l'étape "+(ST_STEP+1)+" ?")) return; ST_EDIT.steps.splice(ST_STEP,1); if(ST_STEP>=ST_EDIT.steps.length) ST_STEP=ST_EDIT.steps.length-1; ST_EDIT.els=ST_EDIT.steps[ST_STEP].els; stSelClear(); ST_UNDO=[]; ST_REDO=[]; renderStepTabs(); stRedraw(); stUpdCount(); stUpdUndoBtns(); }
function stUpdUndoBtns(){ const u=document.getElementById("stUndo"),r=document.getElementById("stRedo"); if(u)u.disabled=!ST_UNDO.length; if(r)r.disabled=!ST_REDO.length; }
// -- compteur de chars par équipe --
function stUpdCount(){ const el=document.getElementById("stCount"); if(!el||!ST_EDIT) return; const by={},order=[]; ST_EDIT.els.forEach(x=>{ if(x.type==='tank'){ const c=x.color||'#5dbb46'; if(by[c]===undefined){by[c]=0;order.push(c);} by[c]++; } }); el.innerHTML=order.map(c=>`<span class="st-cnt"><i style="background:${c}"></i>${by[c]}</span>`).join(''); }
function stTankSync(){ const ed=document.getElementById("stEditor"); if(!ed) return;
  const cs=ed.querySelector(".st-classsel"); if(cs) cs.style.setProperty('--tc',ST_TANK.color);
  ed.querySelectorAll(".st-class").forEach(b=>b.classList.toggle("on",b.dataset.cls===ST_TANK.cls));
  ed.querySelectorAll(".st-tcol").forEach(b=>b.classList.toggle("on",b.dataset.tcol===ST_TANK.color));
}
function stSetTool(t){ if(ST_PATHBUILD&&t!=='path') stFinishPath(true); ST_TOOL=t; stSelClear(); const ed=document.getElementById("stEditor");
  ed.querySelectorAll(".st-tool").forEach(x=>x.classList.toggle("on",x.dataset.tool===t));
  const svg=document.getElementById("stSvg"); if(svg) svg.dataset.tool=t;
  stSyncOptions(); stRedraw(); }
// Champ de texte INLINE sur la carte (remplace prompt). wx,wy = coords 0-1000 ; el = texte existant à éditer, sinon null.
function stTextInput(wx,wy,el){
  const svg=document.getElementById("stSvg"); if(!svg) return;
  const m=stMetrics(svg);
  const sx=m.r.left+m.offX+(wx-ST_ZOOM.x)*m.s, sy=m.r.top+m.offY+(wy-ST_ZOOM.y)*m.s;
  const old=document.getElementById("stTextIn"); if(old) old.remove();
  const inp=document.createElement("input");
  inp.id="stTextIn"; inp.className="st-textin"; inp.maxLength=60; inp.autocomplete="off";
  inp.value=el?(el.text||""):"";
  inp.style.left=Math.round(sx)+"px"; inp.style.top=Math.round(sy-16)+"px";
  inp.style.color=el?(el.color||"#fff"):ST_COLOR;
  inp.style.fontSize=Math.max(13,Math.round(34*m.s))+"px";
  document.body.appendChild(inp); inp.focus(); inp.select();
  let done=false;
  const commit=save=>{ if(done)return; done=true; const t=inp.value.trim().slice(0,60); inp.remove();
    if(save&&t){ stSnapshot(); if(el){ el.text=t; } else { ST_EDIT.els.push({type:'text',color:ST_COLOR,x:Math.round(wx),y:Math.round(wy),text:t}); } stRedraw(); }
    else if(save&&!t&&el){ stSnapshot(); const i=ST_EDIT.els.indexOf(el); if(i>=0) ST_EDIT.els.splice(i,1); stRedraw(); } };
  inp.onkeydown=e=>{ e.stopPropagation(); if(e.key==="Enter"){ e.preventDefault(); commit(true); } else if(e.key==="Escape"){ e.preventDefault(); commit(false); } };
  inp.onblur=()=>commit(true);
}
function stRename(eid){ const el=ST_EDIT.els[eid]; if(!el) return;
  if(el.type==='tank'){ const v=prompt("Nom du char (pseudo / véhicule) :", el.name||""); if(v!==null){ stSnapshot(); el.name=v.trim().slice(0,18); stRedraw(); } }
  else if(el.type==='text'){ stTextInput(el.x, el.y, el); }
  else if(el.type==='marker'){ const v=prompt("Jeton :", el.label||""); if(v!==null){ stSnapshot(); el.label=v.trim().slice(0,4); stRedraw(); } }
}
function stWireEditor(){
  const ed=document.getElementById("stEditor"), svg=document.getElementById("stSvg");
  ed.querySelector("#stName").oninput=e=>ST_EDIT.name=e.target.value;
  // changer de carte invalide le replay (il appartient à une bataille précise)
  ed.querySelector("#stChangeMap").onclick=()=>{ stRpStop(); ST_RP=null; renderMapPicker(); };
  ed.querySelector("#stCancel").onclick=()=>{ stRpStop(); ST_RP=null; stLeaveRoom(); document.body.classList.remove("st-noscroll"); ed.classList.add("hidden"); ed.innerHTML=""; ST_EDIT=null; };
  ed.querySelector("#stSave").onclick=saveStrat;
  ed.querySelector("#stClear").onclick=()=>{ if(!ST_EDIT.els.length) return; if(confirm("Effacer tous les éléments de cette étape ?")){ stSnapshot(); stSetEls([]); stSelClear(); stRedraw(); stUpdCount(); } };
  ed.querySelector("#stStepDel").onclick=stDelStep;
  const noteInp=ed.querySelector("#stStepNote"); if(noteInp){ noteInp.oninput=()=>{ if(ST_EDIT.steps&&ST_EDIT.steps[ST_STEP]) ST_EDIT.steps[ST_STEP].note=noteInp.value.slice(0,140); }; }
  ed.querySelector("#stPresent").onclick=()=>stPresent(ST_EDIT.steps,ST_EDIT.map,ST_EDIT.mode,ST_EDIT.name,ST_STEP);
  const cbtn=ed.querySelector("#stCollab"); if(cbtn) cbtn.onclick=stCollabPicker;
  ed.querySelector("#stDelSel").onclick=()=>stDeleteSel();
  ed.querySelector("#stDup").onclick=()=>stDupSel();
  ed.querySelector("#stUndo").onclick=stUndo;
  ed.querySelector("#stRedo").onclick=stRedo;
  ed.querySelectorAll(".st-tool").forEach(b=>b.onclick=()=>stSetTool(b.dataset.tool));
  ed.querySelectorAll(".st-color").forEach(b=>b.onclick=()=>{ ST_COLOR=b.dataset.color; ed.querySelectorAll(".st-color").forEach(x=>x.classList.toggle("on",x===b)); });
  ed.querySelector("#stDash").onclick=e=>{ ST_STROKE.dash=!ST_STROKE.dash; e.currentTarget.classList.toggle("on",ST_STROKE.dash); };
  ed.querySelector("#stCurve").onclick=e=>{ ST_STROKE.curve=!ST_STROKE.curve; e.currentTarget.classList.toggle("on",ST_STROKE.curve); };
  ed.querySelectorAll(".st-wbtn").forEach(b=>b.onclick=()=>{ ST_STROKE.w=+b.dataset.w; ed.querySelectorAll(".st-wbtn").forEach(x=>x.classList.toggle("on",x===b)); });
  ed.querySelector("#stGridBtn").onclick=e=>{ ST_GRID=!ST_GRID; try{localStorage.setItem('cp_stgrid',ST_GRID?'1':'0');}catch(_){}  e.currentTarget.classList.toggle("on",ST_GRID); const g=document.getElementById("stGrid"); if(g) g.innerHTML=ST_GRID?stGridInner():''; };
  ed.querySelector("#stSnapBtn").onclick=e=>{ ST_SNAP=!ST_SNAP; try{localStorage.setItem('cp_stsnap',ST_SNAP?'1':'0');}catch(_){}  e.currentTarget.classList.toggle("on",ST_SNAP); };
  ed.querySelector("#stLaserBtn").onclick=stLaserToggle;
  ed.querySelector("#stFront").onclick=()=>stZOrder(true);
  ed.querySelector("#stBack").onclick=()=>stZOrder(false);
  ed.querySelectorAll(".st-tcol").forEach(b=>b.onclick=()=>{ ST_TANK.color=b.dataset.tcol; stSetTool('tank'); stTankSync(); });
  ed.querySelectorAll(".st-class").forEach(b=>b.onclick=()=>{ ST_TANK.cls=b.dataset.cls; stSetTool('tank'); stTankSync(); });
  ed.querySelectorAll(".st-stampb").forEach(b=>b.onclick=()=>{ ST_STAMP.kind=b.dataset.stamp; stSetTool('stamp'); ed.querySelectorAll(".st-stampb").forEach(x=>x.classList.toggle("on",x===b)); });
  ed.querySelectorAll(".st-szb").forEach(b=>b.onclick=()=>{ ST_STAMP.size=+b.dataset.sz; ed.querySelectorAll(".st-szb").forEach(x=>x.classList.toggle("on",x===b)); });
  ed.querySelectorAll(".st-tkszb").forEach(b=>b.onclick=()=>{ ST_TANK.size=+b.dataset.sz; ed.querySelectorAll(".st-tkszb").forEach(x=>x.classList.toggle("on",x===b)); });
  ed.querySelectorAll(".st-coneb").forEach(b=>b.onclick=()=>{ ST_CONE.spread=+b.dataset.cone; stSetTool('cone'); ed.querySelectorAll(".st-coneb").forEach(x=>x.classList.toggle("on",x===b)); });
  ed.querySelectorAll(".st-formb").forEach(b=>b.onclick=()=>stDropFormation(b.dataset.form));
  const msel=ed.querySelector("#stMode"); if(msel) msel.onchange=()=>{ ST_EDIT.mode=msel.value; const g=document.getElementById("stBases"); if(g) g.innerHTML=stBasesSvg(ST_EDIT.map,ST_EDIT.mode); };
  const cc=()=>[ST_ZOOM.x+ST_ZOOM.w/2, ST_ZOOM.y+ST_ZOOM.h/2];
  ed.querySelector("#stZoomIn").onclick=()=>{ const [x,y]=cc(); stZoomAt(0.8,x,y); };
  ed.querySelector("#stZoomOut").onclick=()=>{ const [x,y]=cc(); stZoomAt(1.25,x,y); };
  ed.querySelector("#stZoomLvl").onclick=stZoomReset;
  const mm=ed.querySelector("#stMinimap"); if(mm){ const recenter=ev=>{ const r=mm.getBoundingClientRect(); ST_ZOOM.x=(ev.clientX-r.left)/r.width*1000-ST_ZOOM.w/2; ST_ZOOM.y=(ev.clientY-r.top)/r.height*1000-ST_ZOOM.h/2; stApplyZoom(); };
    mm.onpointerdown=ev=>{ ev.preventDefault(); mm._drag=true; try{mm.setPointerCapture(ev.pointerId);}catch(_){}  recenter(ev); };
    mm.onpointermove=ev=>{ if(mm._drag) recenter(ev); };
    mm.onpointerup=ev=>{ mm._drag=false; try{mm.releasePointerCapture(ev.pointerId);}catch(_){} }; }
  ed.querySelector("#stFull").onclick=()=>{ ST_FULL=!ST_FULL; ed.querySelector(".st-editor").classList.toggle("st-full",ST_FULL); document.body.classList.toggle("st-noscroll",ST_FULL); if(!ST_FULL) ed.querySelector(".st-editor").scrollIntoView({behavior:"smooth",block:"start"}); };
  svg.onwheel=e=>{ e.preventDefault(); const p=stPt(e,svg); stZoomAt(e.deltaY<0?0.85:1.18, p[0], p[1]); };
  svg.onpointerdown=e=>{
    e.preventDefault();
    // Pointeur actif : on MONTRE, on ne dessine pas. Le clic fait un ping.
    if(ST_LASER && !ST_SPACE && e.button!==1){ stLaserPing(stPt(e,svg)); return; }
    if(ST_SPACE || e.button===1){ ST_PANNING={sx:e.clientX,sy:e.clientY,vx:ST_ZOOM.x,vy:ST_ZOOM.y}; svg.classList.add("panning"); svg.setPointerCapture(e.pointerId); return; }
    const p=stPt(e,svg); const hit=e.target.closest("[data-eid]"); const eid=hit?+hit.dataset.eid:null;
    if(ST_TOOL==='erase'){ if(eid!=null){ stSnapshot(); ST_EDIT.els.splice(eid,1); stSelClear(); stRedraw(); stUpdCount(); } return; }
    if(ST_TOOL==='select'){
      stHideCtxMenu();
      const hitH=e.target.closest('.st-handle');
      if(hitH && ST_SELS.size===1){ const si=[...ST_SELS][0]; const sel=ST_EDIT.els[si]; const c=stElCenter(sel);
        ST_XFORM={ mode:hitH.dataset.h==='rot'?'rotate':'resize', i:si, orig:JSON.parse(JSON.stringify(sel)), cx:c[0], cy:c[1],
          d0:Math.hypot(p[0]-c[0],p[1]-c[1])||1, a0:Math.atan2(p[1]-c[1],p[0]-c[0])*180/Math.PI, rot0:sel.rot||0, snapped:false };
        svg.setPointerCapture(e.pointerId); return; }
      if(eid!=null){
        if(e.shiftKey){ if(ST_SELS.has(eid)) ST_SELS.delete(eid); else ST_SELS.add(eid); }
        else if(!ST_SELS.has(eid)){ stSelClear(); ST_SELS.add(eid); }
        if(ST_SELS.size){ const orig=new Map(); let ax=Infinity,ay=Infinity;
          ST_SELS.forEach(i=>{ const el=JSON.parse(JSON.stringify(ST_EDIT.els[i])); orig.set(i,el); const b=stElBounds(el); ax=Math.min(ax,b[0]); ay=Math.min(ay,b[1]); });
          ST_MOVE={ox:p[0],oy:p[1],orig,ax,ay,moved:false}; svg.setPointerCapture(e.pointerId); }
      } else {
        ST_BOX={x0:p[0],y0:p[1],x1:p[0],y1:p[1],base:e.shiftKey?new Set(ST_SELS):null}; svg.setPointerCapture(e.pointerId);
      }
      stRedraw(); return;
    }
    if(ST_TOOL==='tank'){ stSnapshot(); ST_EDIT.els.push({type:'tank',cls:ST_TANK.cls,color:ST_TANK.color,x:Math.round(p[0]),y:Math.round(p[1]),name:'',size:ST_TANK.size}); stRedraw(); stUpdCount(); return; }
    if(ST_TOOL==='marker'){ stSnapshot(); ST_EDIT.els.push({type:'marker',color:ST_COLOR,x:Math.round(p[0]),y:Math.round(p[1]),label:stNextMarkerLabel()}); stRedraw(); return; }
    if(ST_TOOL==='text'){ stTextInput(p[0],p[1],null); return; }
    if(ST_TOOL==='stamp'){ stSnapshot(); ST_EDIT.els.push({type:'stamp',kind:ST_STAMP.kind,color:ST_COLOR,x:Math.round(p[0]),y:Math.round(p[1]),size:ST_STAMP.size}); stRedraw(); return; }
    if(ST_TOOL==='cone'){ ST_DRAW={type:'cone',color:ST_COLOR,x:p[0],y:p[1],a:0,spread:ST_CONE.spread,r:0}; svg.setPointerCapture(e.pointerId); return; }
    if(ST_TOOL==='path'){ if(!ST_PATHBUILD){ ST_PATHBUILD={type:'path',color:ST_COLOR,w:ST_STROKE.w,dash:ST_STROKE.dash,pts:[[p[0],p[1]]],cursor:[p[0],p[1]]}; } else { ST_PATHBUILD.pts.push([p[0],p[1]]); ST_PATHBUILD.cursor=[p[0],p[1]]; } stRedraw(); return; }
    if(ST_TOOL==='range'){ ST_DRAW={type:'range',color:ST_COLOR,x:p[0],y:p[1],r:0,m:0}; svg.setPointerCapture(e.pointerId); return; }
    if(ST_TOOL==='pen'){ ST_DRAW={type:'pen',color:ST_COLOR,w:ST_STROKE.w,dash:ST_STROKE.dash,pts:[[p[0],p[1]]]}; svg.setPointerCapture(e.pointerId); return; }
    ST_DRAW={type:ST_TOOL,color:ST_COLOR,w:ST_STROKE.w,dash:ST_STROKE.dash,curve:(ST_TOOL==='arrow'||ST_TOOL==='line')?ST_STROKE.curve:false,x1:p[0],y1:p[1],x2:p[0],y2:p[1],m:0}; svg.setPointerCapture(e.pointerId);
  };
  svg.onpointermove=e=>{
    if(ST_LASER && !ST_PANNING){ stLaserMove(stPt(e,svg)); return; }
    if(ST_PANNING){ const m=stMetrics(svg); ST_ZOOM.x=ST_PANNING.vx-(e.clientX-ST_PANNING.sx)/m.s; ST_ZOOM.y=ST_PANNING.vy-(e.clientY-ST_PANNING.sy)/m.s; stApplyZoom(); return; }
    if(ST_XFORM){ const p=stPt(e,svg); const x=ST_XFORM; if(!x.snapped){ stSnapshot(); x.snapped=true; }
      if(x.mode==='resize'){ const d=Math.hypot(p[0]-x.cx,p[1]-x.cy); ST_EDIT.els[x.i]=stScaleEl(x.orig,d/x.d0,x.cx,x.cy); }
      else { const a=Math.atan2(p[1]-x.cy,p[0]-x.cx)*180/Math.PI; let rot=Math.round(x.rot0+(a-x.a0)); if(ST_SNAP) rot=Math.round(rot/15)*15; rot=((rot%360)+360)%360; if(rot>180) rot-=360; const c=JSON.parse(JSON.stringify(x.orig)); if(rot) c.rot=rot; else delete c.rot; ST_EDIT.els[x.i]=c; }
      stRedraw(); return; }
    if(ST_BOX){ const p=stPt(e,svg); ST_BOX.x1=p[0]; ST_BOX.y1=p[1]; stRedraw(); return; }
    if(ST_MOVE){ const p=stPt(e,svg); let dx=p[0]-ST_MOVE.ox, dy=p[1]-ST_MOVE.oy;
      if(!ST_MOVE.moved&&(Math.abs(dx)>0.5||Math.abs(dy)>0.5)){ stSnapshot(); ST_MOVE.moved=true; }
      if(ST_SNAP){ dx=stSnap(ST_MOVE.ax+dx)-ST_MOVE.ax; dy=stSnap(ST_MOVE.ay+dy)-ST_MOVE.ay; }
      ST_MOVE.orig.forEach((el,i)=>{ ST_EDIT.els[i]=stTranslate(el,dx,dy); }); stRedraw(); return; }
    if(ST_PATHBUILD){ const p=stPt(e,svg); ST_PATHBUILD.cursor=[p[0],p[1]]; stRedraw(); return; }
    if(!ST_DRAW) return; const p=stPt(e,svg);
    if(ST_DRAW.type==='cone'){ const dx=p[0]-ST_DRAW.x, dy=p[1]-ST_DRAW.y; ST_DRAW.a=Math.atan2(dy,dx)*180/Math.PI; ST_DRAW.r=Math.hypot(dx,dy); stRedraw(); return; }
    if(ST_DRAW.type==='range'){ ST_DRAW.r=Math.hypot(p[0]-ST_DRAW.x,p[1]-ST_DRAW.y); ST_DRAW.m=Math.round(ST_DRAW.r/1000*stMapMeters()); stRedraw(); return; }
    if(ST_DRAW.type==='pen'){ ST_DRAW.pts.push([p[0],p[1]]); }
    else { ST_DRAW.x2=p[0]; ST_DRAW.y2=p[1]; if(ST_DRAW.type==='measure') ST_DRAW.m=Math.round(Math.hypot(ST_DRAW.x2-ST_DRAW.x1,ST_DRAW.y2-ST_DRAW.y1)/1000*stMapMeters()); }
    stRedraw();
  };
  svg.onpointerup=e=>{
    try{ svg.releasePointerCapture(e.pointerId); }catch(_){}
    if(ST_PANNING){ ST_PANNING=null; svg.classList.remove("panning"); return; }
    if(ST_XFORM){ ST_XFORM=null; return; }
    if(ST_BOX){ const b=ST_BOX; ST_BOX=null;
      const x0=Math.min(b.x0,b.x1),y0=Math.min(b.y0,b.y1),x1=Math.max(b.x0,b.x1),y1=Math.max(b.y0,b.y1);
      if(Math.hypot(x1-x0,y1-y0)>6){ stSelClear(); if(b.base) b.base.forEach(i=>ST_SELS.add(i));
        ST_EDIT.els.forEach((el,i)=>{ const bb=stElBounds(el); if(bb[0]<=x1&&bb[2]>=x0&&bb[1]<=y1&&bb[3]>=y0) ST_SELS.add(i); }); }
      stRedraw(); return; }
    if(ST_MOVE){ ST_MOVE=null; return; }
    if(!ST_DRAW){ return; }
    const d=ST_DRAW; ST_DRAW=null;
    if(d.type==='pen'){ if(d.pts.length>1){ stSnapshot(); ST_EDIT.els.push(d); } }
    else if(d.type==='range'){ if(d.r>12){ stSnapshot(); ST_EDIT.els.push(d); } }
    else if(d.type==='cone'){ if(d.r>15){ stSnapshot(); ST_EDIT.els.push(d); } }
    else { if(Math.hypot(d.x2-d.x1,d.y2-d.y1)>12){ stSnapshot(); ST_EDIT.els.push(d); } }
    stRedraw();
  };
  svg.ondblclick=e=>{ if(ST_PATHBUILD){ e.preventDefault(); stFinishPath(true); return; } const hit=e.target.closest("[data-eid]"); if(hit) stRename(+hit.dataset.eid); };
  svg.oncontextmenu=e=>{ e.preventDefault(); const hit=e.target.closest("[data-eid]"); const eid=hit?+hit.dataset.eid:null;
    if(eid!=null&&!ST_SELS.has(eid)){ stSelClear(); ST_SELS.add(eid); stRedraw(); }
    stShowCtxMenu(e.clientX,e.clientY,eid); };
  if(!ed._stKeys){ ed._stKeys=true;
    document.addEventListener("keydown",e=>{ if(!ST_EDIT||document.getElementById("stEditor").classList.contains("hidden")||document.getElementById("stPresentOv"))return;
      const t=e.target.tagName; if(t==='INPUT'||t==='TEXTAREA'||t==='SELECT')return; const k=e.key.toLowerCase();
      if((e.ctrlKey||e.metaKey)&&k==='z'){ e.preventDefault(); e.shiftKey?stRedo():stUndo(); return; }
      if((e.ctrlKey||e.metaKey)&&k==='y'){ e.preventDefault(); stRedo(); return; }
      if((e.ctrlKey||e.metaKey)&&k==='c'){ e.preventDefault(); stCopy(); return; }
      if((e.ctrlKey||e.metaKey)&&k==='x'){ e.preventDefault(); stCopy(); stDeleteSel(); return; }
      if((e.ctrlKey||e.metaKey)&&k==='v'){ e.preventDefault(); stPaste(); return; }
      if((e.ctrlKey||e.metaKey)&&k==='d'){ e.preventDefault(); stDupSel(); return; }
      if((e.ctrlKey||e.metaKey)&&k==='a'){ e.preventDefault(); stSelClear(); ST_EDIT.els.forEach((_,i)=>ST_SELS.add(i)); stRedraw(); return; }
      if(e.ctrlKey||e.metaKey||e.altKey) return;
      if(e.key===' '){ if(!ST_SPACE){ ST_SPACE=true; const s=document.getElementById("stSvg"); if(s)s.classList.add("spacing"); } e.preventDefault(); return; }
      if(k==='enter'){ if(ST_PATHBUILD){ e.preventDefault(); stFinishPath(true); } return; }
      if(k==='delete'||k==='backspace'){ if(ST_SELS.size){ e.preventDefault(); stDeleteSel(); } return; }
      if(k==='escape'){ stHideCtxMenu(); if(ST_PATHBUILD){ stFinishPath(false); return; } if(ST_SELS.size){ stSelClear(); stRedraw(); } return; }
      if(k==='arrowup'||k==='arrowdown'||k==='arrowleft'||k==='arrowright'){ if(ST_SELS.size){ e.preventDefault(); const st=e.shiftKey?(ST_SNAP?SNAP_STEP:20):(ST_SNAP?SNAP_STEP:4); const dx=k==='arrowleft'?-st:k==='arrowright'?st:0, dy=k==='arrowup'?-st:k==='arrowdown'?st:0; stNudge(dx,dy); } return; }
      if(k===']'){ if(ST_SELS.size){ e.preventDefault(); stZOrder(true); } return; }
      if(k==='['){ if(ST_SELS.size){ e.preventDefault(); stZOrder(false); } return; }
      if(k==='+'||k==='='){ e.preventDefault(); stZoomAt(0.8, ST_ZOOM.x+ST_ZOOM.w/2, ST_ZOOM.y+ST_ZOOM.h/2); return; }
      if(k==='-'){ e.preventDefault(); stZoomAt(1.25, ST_ZOOM.x+ST_ZOOM.w/2, ST_ZOOM.y+ST_ZOOM.h/2); return; }
      if(k==='0'){ e.preventDefault(); stZoomReset(); return; }
      if(ST_KEYS[k]){ e.preventDefault(); stSetTool(ST_KEYS[k]); } });
    document.addEventListener("keyup",e=>{ if(e.key===' '){ ST_SPACE=false; const s=document.getElementById("stSvg"); if(s)s.classList.remove("spacing"); } }); }
  document.body.classList.toggle("st-noscroll", ST_FULL);
  stTankSync(); stUpdCount(); stUpdUndoBtns(); renderStepTabs(); stSyncOptions();
}
async function saveStrat(){
  if(!ST_EDIT.map){ alert("Choisis une carte."); return; }
  const steps=ST_EDIT.steps.map(st=>({els:st.els, note:st.note||'', t:(st.t!=null?st.t:null)}));
  const payload={ id:ST_EDIT.id||null, name:(ST_EDIT.name||"Stratégie").trim()||"Stratégie", map:ST_EDIT.map, mode:ST_EDIT.mode||"ctf", steps, elements:steps[0].els, editors:ST_EDIT.editors||[],
                  battle_id:ST_EDIT.battleId||null };   // pour retrouver le replay à la réouverture
  const btn=document.getElementById("stSave"); if(btn){btn.disabled=true;btn.textContent="Enregistrement…";}
  const r=await fnCall("strategies",{session:localStorage.getItem(LS_SESSION),action:"save",strategy:payload});
  if(!r.ok){
    if(btn){btn.disabled=false;btn.textContent="✓ Enregistrer";}
    const e=r.j&&r.j.error;
    alert(e==="no_clan" ? "Impossible d'enregistrer : ton compte n'est rattaché à aucun clan. Une stratégie appartient toujours à un clan."
        : e==="forbidden" ? "Enregistrement refusé : il faut être officier de combat (ou collaborateur de cette stratégie)."
        : "Erreur : "+(e||r.status)+((r.j&&r.j.detail)?("\n"+r.j.detail):""));
    return;
  }
  stLeaveRoom(); document.body.classList.remove("st-noscroll");
  const ed=document.getElementById("stEditor"); ed.classList.add("hidden"); ed.innerHTML=""; ST_EDIT=null;
  loadStrats();
}
async function deleteStrat(id){
  if(!confirm("Supprimer cette stratégie ?")) return;
  const r=await fnCall("strategies",{session:localStorage.getItem(LS_SESSION),action:"delete",id:Number(id)});
  if(!r.ok){ alert("Erreur : "+(r.j.error||r.status)); return; }
  loadStrats();
}
function openStratView(s){
  if(!s) return;
  stChatStop(); stLeaveRoom();
  // Débrief consulté en lecture seule : il faut son replay, à l'écran ET pour
  // « Présenter ». Le vidage doit se faire AVANT de construire le HTML, sinon
  // stBasesSvg utiliserait les bases d'un autre replay.
  if(s.battle_id==null && ST_RP){ stRpStop(); ST_RP=null; }
  const rpAcharger = (s.battle_id!=null && (!ST_RP || String(ST_RP.battleId)!==String(s.battle_id)))
                     ? String(s.battle_id) : null;
  const ed=document.getElementById("stEditor"); ed.classList.remove("hidden");
  const steps=stStepsOf(s); let idx=0;
  const nav=steps.length>1?`<div class="st-viewnav"><button class="btn st-navbtn" id="stvPrev">‹</button><span class="st-viewind" id="stvInd"></span><button class="btn st-navbtn" id="stvNext">›</button></div>`:'';
  ed.innerHTML=`<div class="card st-shell dashx st-editor"><div class="st-bar"><b class="tl-view-name">${esc(s.name||"Stratégie")} <span class="st-view-map">· ${esc(ST_MAPNAME[s.map]||prettyMap(s.map))}</span></b><div class="st-presence"></div><div class="st-bar-act"><button class="st-btn${ST_GRID?' st-btn-gold':''}" id="stvGridBtn" title="Grille A-K / 1-0">▦ <span>Grille</span></button><button class="st-btn st-btn-gold" id="stvPresent" title="Plein écran">⛶ <span>Présenter</span></button>${stCanEdit(s)?`<button class="st-btn" id="stEditThis">✎ <span>Modifier</span></button>`:""}<button class="st-x" id="stCloseView" title="Fermer">✕</button></div></div>
    ${nav}
    <div class="st-stage-wrap"><svg class="st-svg st-svg-view" viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg">
      <defs><marker id="st-ah" markerWidth="4.5" markerHeight="4.5" refX="3" refY="2.25" orient="auto"><path d="M0,0 L4.5,2.25 L0,4.5 z" fill="context-stroke"/></marker></defs>
      <image href="maps/top/${esc(s.map||'')}.jpg" x="0" y="0" width="1000" height="1000" preserveAspectRatio="none"/>
      <g id="stvBases" style="pointer-events:none">${stBasesSvg(s.map,s.mode||'ctf')}</g>
      <g id="stvGrid" style="pointer-events:none">${ST_GRID?stGridInner():''}</g>
      <g id="stvReplay" style="pointer-events:none"></g>
      <g id="stvEls"></g></svg></div>
    <div class="tl-card-by">Par ${esc(s.created_by_name||"?")}</div>
    <div class="st-chat"><div class="st-chat-h">💬 Discussion</div><div class="st-chat-list" id="stChatList"><div class="st-chat-empty">Chargement…</div></div><form class="st-chat-form" id="stChatForm"><input class="st-chat-in" id="stChatIn" maxlength="500" placeholder="Écrire un message au clan…" autocomplete="off"><button class="btn tl-save" type="submit">Envoyer</button></form></div></div>`;
  function draw(){ document.getElementById("stvEls").innerHTML=steps[idx].els.map((e,i)=>stElSvg(e,i)).join("");
    // DÉBRIEF EN CONSULTATION : on place les chars du replay à l'instant de l'étape.
    // Sans ça on ne voyait que les annotations, donc on ne comprenait rien.
    if(ST_RP && ST_RP.map===s.map){
      if(steps[idx] && steps[idx].t!=null) ST_RP.t=Math.max(0,Math.min(ST_RP.dur,steps[idx].t));
      stRpDraw("stvReplay");
    }
    const ind=document.getElementById("stvInd"); if(ind) ind.textContent=`Étape ${idx+1} / ${steps.length}`;
    const p=document.getElementById("stvPrev"),n=document.getElementById("stvNext"); if(p)p.disabled=idx===0; if(n)n.disabled=idx===steps.length-1; }
  const pv=document.getElementById("stvPrev"); if(pv) pv.onclick=()=>{ if(idx>0){idx--;draw();} };
  const nx=document.getElementById("stvNext"); if(nx) nx.onclick=()=>{ if(idx<steps.length-1){idx++;draw();} };
  document.getElementById("stvPresent").onclick=()=>stPresent(steps,s.map,s.mode,s.name,idx);
  document.getElementById("stvGridBtn").onclick=e=>{ ST_GRID=!ST_GRID; try{localStorage.setItem('cp_stgrid',ST_GRID?'1':'0');}catch(_){}  e.currentTarget.classList.toggle("on",ST_GRID); document.getElementById("stvGrid").innerHTML=ST_GRID?stGridInner():''; };
  document.getElementById("stCloseView").onclick=()=>{ stChatStop(); stLeaveRoom(); ed.classList.add("hidden"); ed.innerHTML=""; };
  const eb=document.getElementById("stEditThis"); if(eb) eb.onclick=()=>{ stChatStop(); openStratEditor(s); };
  draw();
  // Le replay arrive de façon asynchrone : on rafraîchit alors les bases (elles
  // viennent du replay) et les chars, sans reconstruire toute la vue.
  if(rpAcharger) stRpLoad(rpAcharger, s.map, s.name||"").then(ok=>{
    if(!ok || !ST_RP || String(ST_RP.battleId)!==rpAcharger) return;
    const b=document.getElementById("stvBases"); if(!b) return;      // vue déjà fermée
    b.innerHTML=stBasesSvg(s.map,s.mode||'ctf'); draw();
  });
  if(s.id){ stChatStart(Number(s.id)); stJoinRoom(Number(s.id),'view'); } ed.scrollIntoView({behavior:"smooth",block:"start"});
}
// -- Chat par stratégie (sondage léger toutes les 5 s tant que la vue est ouverte) --
let ST_CHAT_TIMER=null, ST_CHAT_SID=null, ST_CHAT_SEEN=0;
function stChatStop(){ if(ST_CHAT_TIMER){ clearInterval(ST_CHAT_TIMER); ST_CHAT_TIMER=null; } ST_CHAT_SID=null; }
async function stChatStart(sid){ stChatStop(); ST_CHAT_SID=sid; ST_CHAT_SEEN=0;
  const form=document.getElementById("stChatForm");
  if(form) form.onsubmit=async e=>{ e.preventDefault(); const inp=document.getElementById("stChatIn"); const t=(inp.value||"").trim(); if(!t) return; inp.value=""; inp.disabled=true;
    const r=await fnCall("strat-chat",{session:localStorage.getItem(LS_SESSION),action:"post",strategy_id:sid,body:t});
    inp.disabled=false; inp.focus(); if(!r.ok){ alert("Message non envoyé : "+((r.j&&r.j.error)||r.status)); return; } stChatLoad(true); };
  await stChatLoad(true);
  ST_CHAT_TIMER=setInterval(()=>stChatLoad(false),5000);
}
async function stChatLoad(scroll){ const sid=ST_CHAT_SID; if(!sid) return;
  const r=await fnCall("strat-chat",{session:localStorage.getItem(LS_SESSION),action:"list",strategy_id:sid});
  if(ST_CHAT_SID!==sid) return;   // vue changée entre-temps
  const box=document.getElementById("stChatList"); if(!box) return;
  if(!r.ok){ box.innerHTML='<div class="st-chat-empty">Discussion indisponible ('+esc((r.j&&r.j.error)||String(r.status))+').</div>'; return; }
  const msgs=r.j.messages||[];
  if(!msgs.length){ box.innerHTML='<div class="st-chat-empty">Aucun message. Lance la discussion !</div>'; return; }
  const atBottom = box.scrollHeight-box.scrollTop-box.clientHeight < 40;
  box.innerHTML=msgs.map(m=>{ const mine=Number(m.account_id)===Number(STRAT_ME);
    return `<div class="st-msg${mine?' mine':''}"><div class="st-msg-who">${esc(m.nickname||'?')} <span class="st-msg-t">${stChatTime(m.created_at)}</span></div><div class="st-msg-b">${esc(m.body||'')}</div></div>`; }).join('');
  if(scroll||atBottom||msgs.length>ST_CHAT_SEEN) box.scrollTop=box.scrollHeight;
  ST_CHAT_SEEN=msgs.length;
}
function stChatTime(iso){ try{ const d=new Date(iso); return d.toLocaleString(window.CP_LOC,{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}); }catch(_){ return ''; } }
// Sélecteur de collaborateurs (rôles fins) : membres autorisés à éditer cette stratégie
function stCollabPicker(){
  if(!ST_EDIT) return;
  const list=(MEMBERS||[]).slice().sort((a,b)=>String(a.nickname||a.name||'').localeCompare(String(b.nickname||b.name||'')));
  const ov=document.createElement('div'); ov.className='st-collab-ov dashx'; ov.id='stCollabOv';
  const row=m=>{ const id=Number(m.account_id); if(!id) return ''; const nm=esc(m.nickname||m.name||('#'+id)); const on=ST_EDIT.editors.includes(id);
    return `<label class="st-collab-row"><input type="checkbox" data-acc="${id}"${on?' checked':''}><span>${nm}</span></label>`; };
  ov.innerHTML=`<div class="st-collab-box"><div class="st-collab-top"><b>👥 Collaborateurs</b><button class="st-present-x" id="stcX" title="Fermer">✕</button></div>
    <div class="st-collab-hint">Coche les membres autorisés à modifier cette stratégie (en plus des officiers de combat et +).</div>
    <input class="st-collab-search" id="stcSearch" placeholder="Rechercher un membre…" autocomplete="off">
    <div class="st-collab-list" id="stcList">${list.map(row).join('')||'<div class="st-collab-empty">Aucun membre chargé.</div>'}</div>
    <div class="st-collab-foot"><span class="st-collab-cnt" id="stcCount"></span><button class="btn tl-save" id="stcDone">Terminé</button></div></div>`;
  document.body.appendChild(ov);
  const upd=()=>{ ov.querySelector('#stcCount').textContent=ST_EDIT.editors.length+' autorisé(s) en plus'; };
  ov.querySelectorAll('input[data-acc]').forEach(cb=>cb.onchange=()=>{ const id=+cb.dataset.acc; if(cb.checked){ if(!ST_EDIT.editors.includes(id)) ST_EDIT.editors.push(id); } else { ST_EDIT.editors=ST_EDIT.editors.filter(x=>x!==id); } upd(); });
  ov.querySelector('#stcSearch').oninput=e=>{ const qy=e.target.value.toLowerCase(); ov.querySelectorAll('.st-collab-row').forEach(r=>{ r.style.display=r.textContent.toLowerCase().includes(qy)?'':'none'; }); };
  const close=()=>ov.remove(); ov.querySelector('#stcX').onclick=close; ov.querySelector('#stcDone').onclick=close;
  ov.onclick=e=>{ if(e.target===ov) close(); };
  upd();
}
// Mode présentation plein écran : déroule les étapes (‹ › clavier, Échap pour quitter)
// Interpolation d'un élément entre deux étapes (pour l'animation de présentation).
function stLerpEl(a,b,t){ if(!a||!b||a.type!==b.type) return b; const c=JSON.parse(JSON.stringify(b)); const L=(x,y)=>x+(y-x)*t;
  if(b.x1!=null&&a.x1!=null){ c.x1=L(a.x1,b.x1);c.y1=L(a.y1,b.y1);c.x2=L(a.x2,b.x2);c.y2=L(a.y2,b.y2); }
  else if(b.pts&&a.pts&&a.pts.length===b.pts.length){ c.pts=b.pts.map((p,k)=>[L(a.pts[k][0],p[0]),L(a.pts[k][1],p[1])]); }
  else if(b.x!=null&&a.x!=null){ c.x=L(a.x,b.x);c.y=L(a.y,b.y);
    if(b.size!=null&&a.size!=null)c.size=L(a.size,b.size); if(b.r!=null&&a.r!=null)c.r=L(a.r,b.r);
    if(b.a!=null&&a.a!=null)c.a=L(a.a,b.a); }
  if(b.rot!=null||a.rot!=null){ const rr=L(a.rot||0,b.rot||0); if(rr) c.rot=rr; else delete c.rot; }
  return c; }
let ST_PRES_ANIM=(typeof localStorage==='undefined')||localStorage.getItem('cp_stanim')!=='0';
function stPresent(steps,map,mode,name,start){
  if(!steps||!steps.length) return; let idx=Math.max(0,Math.min(steps.length-1,start||0)); let animRAF=0;
  // MODE DÉBRIEF : le replay tourne en fond et fait apparaître les diapos épinglées
  // à leur instant. Actif seulement si un replay est chargé ET qu'au moins une
  // diapo est épinglée — sinon c'est une présentation de stratégie classique.
  const RP=(ST_RP && ST_RP.dur>0 && ST_RP.map===map && steps.some(s=>s.t!=null)) ? ST_RP : null;
  const ov=document.createElement("div"); ov.className="st-present-ov dashx"; ov.id="stPresentOv";
  ov.innerHTML=`<div class="st-present-top"><b>${esc(name||"Stratégie")}</b><span class="st-present-map">${esc(ST_MAPNAME[map]||prettyMap(map))}</span><button class="st-present-x" id="stpAnimBtn" title="Animer les transitions entre étapes" style="margin-left:auto;width:auto;padding:0 12px">✨</button><button class="st-present-x" id="stpLaserBtn" title="Pointeur laser (L)" style="width:auto;padding:0 12px">🔴</button><button class="st-present-x" id="stpGridBtn" title="Grille A-K / 1-0" style="width:auto;padding:0 12px">▦</button><button class="st-present-x" id="stpX" title="Quitter (Échap)">✕</button></div>
    <div class="st-present-stage" id="stpStage"><svg viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg">
      <defs><marker id="st-ah" markerWidth="4.5" markerHeight="4.5" refX="3" refY="2.25" orient="auto"><path d="M0,0 L4.5,2.25 L0,4.5 z" fill="context-stroke"/></marker></defs>
      <image href="maps/top/${esc(map||'')}.jpg" x="0" y="0" width="1000" height="1000" preserveAspectRatio="none"/>
      <g style="pointer-events:none">${stBasesSvg(map,mode||'ctf')}</g><g id="stpGrid" style="pointer-events:none">${ST_GRID?stGridInner():''}</g><g id="stpReplay" style="pointer-events:none"></g><g id="stpEls"></g><g id="stpLaser" style="pointer-events:none"></g></svg><div class="st-present-note" id="stpNote"></div></div>
    ${RP?`<div class="st-present-nav" style="gap:10px"><button class="st-pbtn" id="stpRpPlay" style="min-width:44px">▶</button><span id="stpRpTime" style="font-variant-numeric:tabular-nums;font-size:13px;opacity:.85;min-width:86px;text-align:center">0:00 / 0:00</span><input type="range" id="stpRpScrub" min="0" max="${RP.dur}" step="0.1" value="0" style="flex:1;max-width:640px;accent-color:var(--accent)"><button class="st-pbtn" id="stpRpSpeed" title="Vitesse de lecture" style="min-width:52px">×2</button></div>`:''}
    <div class="st-present-nav"><button class="st-pbtn" id="stpPrev">‹ Précédent</button><span class="st-present-ind" id="stpInd"></span><button class="st-pbtn" id="stpNext">Suivant ›</button></div>`;
  document.body.appendChild(ov);
  const elsG=ov.querySelector("#stpEls"), noteEl=ov.querySelector("#stpNote");
  function paint(arr){ elsG.innerHTML=arr.map((e,i)=>stElSvg(e,i)).join(""); }
  function setNote(){ const n=(steps[idx]&&steps[idx].note)?String(steps[idx].note):''; noteEl.textContent=n; noteEl.style.display=n?'block':'none'; }
  function draw(fromIdx){ cancelAnimationFrame(animRAF);
    const to=steps[idx].els;
    if(ST_PRES_ANIM && fromIdx!=null && steps[fromIdx] && fromIdx!==idx){
      const from=steps[fromIdx].els, t0=performance.now(), dur=460;
      (function frame(now){ let t=Math.min(1,(now-t0)/dur); const e=t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
        paint(to.map((el,i)=>stLerpEl(from[i],el,e))); if(t<1) animRAF=requestAnimationFrame(frame); })(t0);
    } else paint(to);
    ov.querySelector("#stpInd").textContent=`Étape ${idx+1} / ${steps.length}`; setNote();
    ov.querySelector("#stpPrev").disabled=idx===0; ov.querySelector("#stpNext").disabled=idx===steps.length-1; }
  function go(d){ const prev=pBlank?null:idx; idx=Math.max(0,Math.min(steps.length-1,idx+d)); pBlank=false; draw(prev);
    // en débrief, avancer d'une diapo à la main = mettre en pause et se caler sur son instant
    if(RP){ pPause(); const st=steps[idx]; if(st.t!=null){ RP.t=Math.max(0,Math.min(RP.dur,st.t)); pPaint(); } } }
  function close(){ document.removeEventListener("keydown",key); cancelAnimationFrame(animRAF); pPause();
    if(document.fullscreenElement) document.exitFullscreen().catch(()=>{}); ov.remove();
    if(RP){ try{ stRpDraw(); stRpSync(); }catch(_){} }   // l'éditeur reprend là où le débrief s'est arrêté
  }
  function key(e){ const k=(e.key||'').toLowerCase();
    if(e.key===" " && RP){ e.preventDefault(); pToggle(); }
    else if(e.key==="ArrowRight"||e.key===" "){ e.preventDefault(); go(1); } else if(e.key==="ArrowLeft"){ e.preventDefault(); go(-1); } else if(k==="l"){ toggleLaser(); } else if(e.key==="Escape"){ close(); } }
  /* ---------- lecture du replay pendant la présentation ---------- */
  let pRAF=0, pBlank=false;
  function pPaint(){ if(!RP) return; stRpDraw("stpReplay");
    const sc=ov.querySelector("#stpRpScrub"), tm=ov.querySelector("#stpRpTime");
    if(sc) sc.value=RP.t; if(tm) tm.textContent=stRpFmt(RP.t)+" / "+stRpFmt(RP.dur); }
  function pPause(){ if(pRAF){ cancelAnimationFrame(pRAF); pRAF=0; } const b=ov.querySelector("#stpRpPlay"); if(b) b.textContent="▶"; }
  function pPlay(){ if(!RP||pRAF) return; if(RP.t>=RP.dur){ RP.t=0; pBlank=false; }
    RP.last=performance.now(); const b=ov.querySelector("#stpRpPlay"); if(b) b.textContent="⏸";
    pRAF=requestAnimationFrame(pFrame); }
  function pToggle(){ if(pRAF) pPause(); else pPlay(); }
  function pFrame(now){ pRAF=0; if(!RP) return;
    const dt=(now-RP.last)/1000; RP.last=now;
    RP.t=Math.min(RP.dur, RP.t+dt*(RP.speed||2));
    pPaint(); pFollow();
    if(RP.t>=RP.dur){ pPause(); return; }
    pRAF=requestAnimationFrame(pFrame); }
  // Fait apparaître la diapo épinglée dont l'instant vient d'être atteint.
  // Avant la toute première : tableau blanc, on ne voit que le replay.
  function pFollow(){ if(!RP) return;
    let want=-1; steps.forEach((s,i)=>{ if(s.t!=null && s.t<=RP.t+0.001) want=i; });
    if(want<0){ if(!pBlank){ pBlank=true; cancelAnimationFrame(animRAF); elsG.innerHTML=""; noteEl.style.display="none";
        ov.querySelector("#stpInd").textContent="Avant la 1re diapo"; ov.querySelector("#stpPrev").disabled=true; ov.querySelector("#stpNext").disabled=false; } return; }
    if(pBlank || want!==idx){ const prev=pBlank?null:idx; pBlank=false; idx=want; draw(prev); } }
  // --- pointeur laser ---
  const svg=ov.querySelector("svg"), laserG=ov.querySelector("#stpLaser"); let laserOn=false;
  function laserPt(ev){ const r=svg.getBoundingClientRect(); return [ (ev.clientX-r.left)/r.width*1000, (ev.clientY-r.top)/r.height*1000 ]; }
  function onMove(ev){ if(!laserOn) return; const p=laserPt(ev); laserG.innerHTML=`<circle cx="${p[0]}" cy="${p[1]}" r="13" fill="#ff2d2d" fill-opacity=".28"/><circle cx="${p[0]}" cy="${p[1]}" r="6" fill="#ff3b3b"/><circle cx="${p[0]}" cy="${p[1]}" r="6" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="1.4"/>`; }
  function onDown(ev){ if(!laserOn) return; const p=laserPt(ev); const ping=document.createElementNS("http://www.w3.org/2000/svg","circle"); ping.setAttribute("cx",p[0]); ping.setAttribute("cy",p[1]); ping.setAttribute("fill","none"); ping.setAttribute("stroke","#ff3b3b"); ping.setAttribute("stroke-width","3"); ping.setAttribute("r","6"); ping.style.transition="all .5s ease-out"; laserG.appendChild(ping); requestAnimationFrame(()=>{ ping.setAttribute("r","46"); ping.style.opacity="0"; }); setTimeout(()=>ping.remove(),520); }
  function toggleLaser(){ laserOn=!laserOn; ov.querySelector("#stpLaserBtn").classList.toggle("on",laserOn); ov.querySelector("#stpStage").classList.toggle("st-laser-on",laserOn); if(!laserOn) laserG.innerHTML=''; }
  svg.addEventListener("pointermove",onMove); svg.addEventListener("pointerdown",onDown);
  ov.querySelector("#stpPrev").onclick=()=>go(-1); ov.querySelector("#stpNext").onclick=()=>go(1); ov.querySelector("#stpX").onclick=close;
  ov.querySelector("#stpLaserBtn").onclick=toggleLaser;
  ov.querySelector("#stpAnimBtn").classList.toggle("on",ST_PRES_ANIM);
  ov.querySelector("#stpAnimBtn").onclick=e=>{ ST_PRES_ANIM=!ST_PRES_ANIM; try{localStorage.setItem('cp_stanim',ST_PRES_ANIM?'1':'0');}catch(_){}  e.currentTarget.classList.toggle("on",ST_PRES_ANIM); };
  ov.querySelector("#stpGridBtn").onclick=()=>{ ST_GRID=!ST_GRID; try{localStorage.setItem('cp_stgrid',ST_GRID?'1':'0');}catch(_){}  ov.querySelector("#stpGrid").innerHTML=ST_GRID?stGridInner():''; };
  document.addEventListener("keydown",key); draw();
  if(RP){
    stRpStop();                                   // l'éditeur ne doit pas tourner en parallèle
    const sp=ov.querySelector("#stpRpSpeed"); sp.textContent="×"+(RP.speed||2);
    sp.onclick=()=>{ RP.speed=({1:2,2:4,4:1})[RP.speed||2]||2; sp.textContent="×"+RP.speed; };
    ov.querySelector("#stpRpPlay").onclick=pToggle;
    const sc=ov.querySelector("#stpRpScrub");
    sc.oninput=e=>{ const v=Number(e.target.value)||0; pPause(); RP.t=Math.max(0,Math.min(RP.dur,v)); pPaint(); pFollow(); };
    // Présenter depuis la 1re diapo = partir du début de la bataille (tableau blanc,
    // les diapos arrivent d'elles-mêmes). Depuis une diapo précise = partir de son instant.
    RP.t=(idx>0 && steps[idx] && steps[idx].t!=null) ? steps[idx].t : 0;
    pPaint(); pFollow();
  }
  if(ov.requestFullscreen) ov.requestFullscreen().catch(()=>{});
}

/* ============================================================
   MENU LATÉRAL
   ============================================================ */
function toggleSidebar(){
  const sb=document.getElementById("sidebar");
  const c=!sb.classList.contains("collapsed");
  sb.classList.toggle("collapsed",c);
  localStorage.setItem("cp_sidebar", c?"1":"0");
  if(playerActive()) renderPlayerView();
}

/* ============================================================
   CLASSEMENTS DES CLANS (mondial EU, par mesure)
   ============================================================ */
const RK_METRICS=[
  ["fort_elo_rating","Niveau Bastion (global)"],
  ["fort_elo_rating_10","Bastion — tier 10"],
  ["fort_elo_rating_8","Bastion — tier 8"],
  ["fort_elo_rating_6","Bastion — tier 6"],
  ["gm_elo_rating","Carte Globale (Clan Wars)"],
  ["efficiency","Efficacité"],
  ["wins_ratio_avg","% de victoires"],
  ["global_rating_avg","Niveau moyen des joueurs"],
];
let RK_METRIC="fort_elo_rating";
const RK_MINE_FIELD={fort_elo_rating:"fb_elo_rating",fort_elo_rating_10:"fb_elo_rating_10",
  fort_elo_rating_8:"fb_elo_rating_8",fort_elo_rating_6:"fb_elo_rating_6",gm_elo_rating:"gm_elo_rating",
  efficiency:"efficiency",wins_ratio_avg:"wins_ratio_avg",global_rating_avg:"global_rating_avg"};
function rkFmt(metric,v){ return metric==="wins_ratio_avg" ? fmt(v,2)+" %" : fmt(v); }
/* Classement des clans — module complet (chargement de tout le classement,
   podium, carte "ton clan", tri/recherche/pagination). Encapsulé pour ne
   pas entrer en collision avec les variables globales de l'app. */
let CR_INITED=false;
function loadRanking(){
  const clanId = Number(localStorage.getItem("cp_clan")) || (CLANINFO&&CLANINFO.clan_id) || 0;
  const clanTag = (typeof CLANTAG!=="undefined"&&CLANTAG) ? CLANTAG : ((CLANINFO&&CLANINFO.tag)||"");
  initClanRanking(clanId, clanTag);
}
function initClanRanking(clanIdIn, clanTagIn){
  const root = document.getElementById("clanRanking");
  if(!root || CR_INITED) return;
  CR_INITED = true;

  const ownCountries = (typeof CLANPROFILE!=="undefined" && CLANPROFILE && Array.isArray(CLANPROFILE.langs) && CLANPROFILE.langs.length && clanIdIn)
    ? { [String(clanIdIn)]: CLANPROFILE.langs } : {};
  const CONFIG = { api:"https://api.worldoftanks.eu", applicationId: WG_APP_ID,
    clanId: Number(clanIdIn)||0, clanTag: clanTagIn||"", pageSize:20, declaredCountries: ownCountries };

  const METRICS = [
    ["fort_elo_rating_10","Bastion — tier 10"],["fort_elo_rating_8","Bastion — tier 8"],
    ["fort_elo_rating_6","Bastion — tier 6"],["fort_elo_rating","Niveau Bastion global"],
    ["gm_elo_rating","Carte Globale"],["efficiency","Efficacité"],
    ["wins_ratio_avg","% de victoires"],["global_rating_avg","Niveau moyen des joueurs"]
  ];
  const RESPONSE_FIELD = { fort_elo_rating:"fb_elo_rating", fort_elo_rating_10:"fb_elo_rating_10",
    fort_elo_rating_8:"fb_elo_rating_8", fort_elo_rating_6:"fb_elo_rating_6", gm_elo_rating:"gm_elo_rating",
    efficiency:"efficiency", wins_ratio_avg:"wins_ratio_avg", global_rating_avg:"global_rating_avg" };
  const COUNTRIES = { fr:["🇫🇷","France"],be:["🇧🇪","Belgique"],ch:["🇨🇭","Suisse"],ca:["🇨🇦","Canada"],
    lu:["🇱🇺","Luxembourg"],de:["🇩🇪","Allemagne"],gb:["🇬🇧","Royaume-Uni"],es:["🇪🇸","Espagne"],
    it:["🇮🇹","Italie"],pt:["🇵🇹","Portugal"],nl:["🇳🇱","Pays-Bas"],pl:["🇵🇱","Pologne"],cz:["🇨🇿","Tchéquie"],
    sk:["🇸🇰","Slovaquie"],hu:["🇭🇺","Hongrie"],ro:["🇷🇴","Roumanie"],gr:["🇬🇷","Grèce"],se:["🇸🇪","Suède"],
    no:["🇳🇴","Norvège"],fi:["🇫🇮","Finlande"],dk:["🇩🇰","Danemark"],ua:["🇺🇦","Ukraine"],tr:["🇹🇷","Turquie"],
    ma:["🇲🇦","Maroc"],dz:["🇩🇿","Algérie"],tn:["🇹🇳","Tunisie"] };

  const state = { metric:"fort_elo_rating_10", page:1, query:"", sortKey:"rank", sortDir:"asc",
    rows:[], ratings:null, focusMine:false, cache:new Map(), emblems:new Map() };
  const ui = { metric:root.querySelector("#crMetric"), search:root.querySelector("#crSearch"),
    status:root.querySelector("#crStatus"), own:root.querySelector("#crOwn"), podium:root.querySelector("#crPodium"),
    rows:root.querySelector("#crRows"), count:root.querySelector("#crCount"), pager:root.querySelector("#crPagination"),
    side:root.querySelector("#crSide"), mine:root.querySelector("#crMyClan") };

  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const fmt = (v,d=0) => { const n=Number(v); return Number.isFinite(n) ? n.toLocaleString(window.CP_LOC,{minimumFractionDigits:d,maximumFractionDigits:d}) : "—"; };
  const metricLabel = () => METRICS.find(([k])=>k===state.metric)?.[1] || "Classement";
  const score = v => state.metric==="wins_ratio_avg" ? `${fmt(v,2)} %` : fmt(v);

  async function api(path, params){
    const query = new URLSearchParams({ application_id:CONFIG.applicationId, language:"fr", ...params });
    const response = await fetch(`${CONFIG.api}${path}?${query}`);
    const json = await response.json();
    if(!response.ok || json.status!=="ok") throw new Error(json.error?.message || "API Wargaming indisponible");
    return json;
  }
  function normalizeRows(rows, field){
    return (Array.isArray(rows)?rows:[]).map(clan=>{ const stat=clan?.[field]||{};
      return { clanId:Number(clan.clan_id), tag:clan.clan_tag||"", name:clan.clan_name||"", rank:stat.rank,
        value:stat.value, rankDelta:stat.rank_delta, activity:clan.battles_count_avg_daily?.value,
        countries:CONFIG.declaredCountries[String(clan.clan_id)]||[] };
    }).filter(clan=>clan.rank!=null && clan.value!=null);
  }
  async function fetchAllRanking(){
    if(state.cache.has(state.metric)) return state.cache.get(state.metric);
    const field = RESPONSE_FIELD[state.metric];
    const fields = ["clan_id","clan_tag","clan_name",field,"battles_count_avg_daily"].join(",");
    const all=[];
    for(let page=1; page<=50; page+=1){
      const json = await api("/wot/clanratings/top/", { rank_field:state.metric, limit:1000, page_no:page, fields });
      all.push(...normalizeRows(json.data, field));
      if(!Array.isArray(json.data) || json.data.length<1000) break;
    }
    state.cache.set(state.metric, all);
    return all;
  }
  async function fetchOwnRatings(){
    if(!CONFIG.clanId){ state.ratings=null; return; }
    const json = await api("/wot/clanratings/clans/", { clan_id:CONFIG.clanId });
    state.ratings = json.data?.[String(CONFIG.clanId)] || null;
  }
  async function fetchVisibleEmblems(rows){
    const missing = [...new Set(rows.map(r=>String(r.clanId)).filter(id=>id && !state.emblems.has(id)))];
    if(!missing.length) return false;
    missing.forEach(id=>state.emblems.set(id,null));
    const json = await api("/wgn/clans/info/", { clan_id:missing.join(","), fields:"clan_id,tag,emblems" });
    Object.entries(json.data||{}).forEach(([id,clan])=>{ const e=clan?.emblems||{};
      state.emblems.set(id, e.x32?.portal || e.x64?.portal || e.x64?.wot || null); });
    return true;
  }
  function getSortValue(row){ if(state.sortKey==="activity")return row.activity; if(state.sortKey==="evolution")return row.rankDelta; if(state.sortKey==="score")return row.value; return row.rank; }
  function sortedRows(){
    const query = state.query.trim().toLowerCase();
    return state.rows.filter(row=>!query || row.tag.toLowerCase().includes(query) || row.name.toLowerCase().includes(query)).slice()
      .sort((a,b)=>{ const av=Number(getSortValue(a)), bv=Number(getSortValue(b));
        if(!Number.isFinite(av)&&!Number.isFinite(bv))return 0; if(!Number.isFinite(av))return 1; if(!Number.isFinite(bv))return -1;
        return state.sortDir==="asc" ? av-bv : bv-av; });
  }
  function countryHTML(row){
    const countries = row.countries.map(c=>COUNTRIES[c]).filter(Boolean);
    if(!countries.length) return '<span class="cr-country unknown"><span>🌐</span><span>Non renseigné</span></span>';
    return `<span class="cr-country" title="Pays déclaré par le staff"><span>${countries.map(i=>i[0]).join(" ")}</span><span>${esc(countries.map(i=>i[1]).join(", "))}</span></span>`;
  }
  function emblemHTML(row){ const url=state.emblems.get(String(row.clanId)); return url ? `<img src="${esc(url)}" alt="Emblème ${esc(row.tag)}">` : esc(row.tag.slice(0,3)||"?"); }
  function renderOwn(){
    const field=RESPONSE_FIELD[state.metric], stat=state.ratings?.[field], activity=state.ratings?.battles_count_avg_daily?.value;
    const delta=Number(stat?.rank_delta||0), up=delta>=0;
    ui.mine.disabled = stat?.rank==null;
    ui.own.innerHTML = `
      <div class="cr-card-label">Position de ton clan · ${esc(metricLabel())}</div>
      <div class="cr-own-main"><span class="cr-mark">${esc(CONFIG.clanTag||"—")}</span><div>
        <div class="cr-rank">#${stat?.rank!=null?fmt(stat.rank):"—"}</div>
        <div class="cr-clan-name"><b>[${esc(CONFIG.clanTag||"—")}]</b> ${esc(state.ratings?.clan_name||"Votre clan")}</div>
        ${delta?`<span class="cr-delta ${up?"up":"down"}">${up?"▲":"▼"} ${Math.abs(delta)} place${Math.abs(delta)>1?"s":""}</span>`:""}
      </div></div>
      <div class="cr-own-foot">
        <span>Score actuel<b>${stat?.value!=null?score(stat.value):"—"}</b></span>
        <span>Variation officielle<b>${delta?`${up?"+":"−"}${Math.abs(delta)} place${Math.abs(delta)>1?"s":""}`:"Stable"}</b></span>
        <span>Activité / jour<b>${activity!=null?fmt(activity,2):"—"}</b></span>
      </div>`;
  }
  function renderPodium(){
    const podium = state.rows.slice().sort((a,b)=>a.rank-b.rank).slice(0,3);
    const byRank = r => podium.find(row=>row.rank===r) || {};
    const card = (row,rank) => `<div class="cr-podium-card ${rank===1?"first":""}"><span class="cr-medal">${rank}</span><strong>[${esc(row.tag||"—")}]</strong><small>${esc(row.name||"Aucun clan")}</small><em>${row.value!=null?score(row.value):"—"}</em></div>`;
    ui.podium.innerHTML = `<header><b>Podium européen</b><span>${esc(metricLabel())}</span></header><div class="cr-podium-grid">${card(byRank(2),2)}${card(byRank(1),1)}${card(byRank(3),3)}</div>`;
  }
  function renderSide(){
    const best = state.rows.slice().sort((a,b)=>a.rank-b.rank)[0];
    const rating = k => state.ratings?.[k];
    const tier = (label,stat) => { const width=stat?.value?Math.max(8,Math.min(100,Number(stat.value)/1300*100)):0;
      return `<div class="cr-tier"><span>${label}</span><span class="cr-track"><i class="cr-fill" style="width:${width}%"></i></span><b>${stat?.value!=null?fmt(stat.value):"—"}</b></div>`; };
    ui.side.innerHTML = `
      <section class="cr-side-card"><h3>Meilleur score</h3><p>Meilleure cote actuelle pour ${esc(metricLabel())}.</p>
        <div class="cr-best">${best?score(best.value):"—"}</div><p>${best?`Détenue par <b>[${esc(best.tag)}]</b> ${esc(best.name)}.`:"Donnée indisponible."}</p></section>
      <section class="cr-side-card"><h3>Cotes Bastion officielles</h3>
        ${tier("Tier X",rating("fb_elo_rating_10"))}${tier("Tier VIII",rating("fb_elo_rating_8"))}${tier("Tier VI",rating("fb_elo_rating_6"))}</section>`;
  }
  function renderPagination(total){
    const totalPages = Math.max(1, Math.ceil(total/CONFIG.pageSize));
    if(state.page>totalPages) state.page=totalPages;
    const pages=[];
    if(state.page>3) pages.push(1,"…");
    for(let page=Math.max(1,state.page-2); page<=Math.min(totalPages,state.page+2); page+=1) pages.push(page);
    if(totalPages>state.page+2) pages.push("…",totalPages);
    const buttons=[...new Set(pages)].map(page=>page==="…"?"<span>…</span>":`<button type="button" data-page="${page}" class="${page===state.page?"active":""}">${page}</button>`).join("");
    ui.pager.innerHTML = `<button type="button" data-page="${state.page-1}" ${state.page===1?"disabled":""}>‹ Précédent</button>${buttons}<button type="button" data-page="${state.page+1}" ${state.page===totalPages?"disabled":""}>Suivant ›</button><span>${fmt(total)} clans · ${CONFIG.pageSize} par page</span>`;
    ui.pager.querySelectorAll("button[data-page]").forEach(button=>{
      button.addEventListener("click",()=>{ const page=Number(button.dataset.page); if(!page||page===state.page)return;
        state.page=page; renderTable(); root.querySelector(".cr-table-card").scrollIntoView({behavior:"smooth",block:"start"}); });
    });
  }
  function renderTable(){
    const all=sortedRows(), start=(state.page-1)*CONFIG.pageSize, visible=all.slice(start,start+CONFIG.pageSize);
    ui.count.textContent = `Page ${state.page} · ${fmt(all.length)} clan${all.length>1?"s":""}`;
    ui.rows.innerHTML = visible.length ? visible.map(row=>{ const mine=row.clanId===CONFIG.clanId, delta=Number(row.rankDelta||0);
      return `<tr class="${mine?"mine":""}" data-clan-id="${row.clanId}"><td>#${fmt(row.rank)}</td>
        <td><div class="cr-clan"><span class="cr-emblem">${emblemHTML(row)}</span><span><b>[${esc(row.tag)}]</b><small>${esc(row.name)}</small></span></div></td>
        <td>${countryHTML(row)}</td><td>${row.activity!=null?fmt(row.activity,2):"—"}</td>
        <td class="${delta>0?"cr-positive":delta<0?"cr-negative":""}">${delta?`${delta>0?"▲":"▼"}${Math.abs(delta)}`:"—"}</td>
        <td class="cr-score">${score(row.value)}</td></tr>`; }).join("")
      : '<tr><td colspan="6" class="cr-empty">Aucun clan ne correspond à cette recherche.</td></tr>';
    root.querySelectorAll("[data-cr-sort]").forEach(button=>{ const active=button.dataset.crSort===state.sortKey;
      button.classList.toggle("active",active); button.querySelector("i").textContent = active?(state.sortDir==="asc"?"▲":"▼"):"↕"; });
    renderPagination(all.length);
    if(state.focusMine){ const row=ui.rows.querySelector(`[data-clan-id="${CONFIG.clanId}"]`);
      if(row){ row.classList.add("focus"); requestAnimationFrame(()=>row.scrollIntoView({behavior:"smooth",block:"center"})); setTimeout(()=>row.classList.remove("focus"),2400); }
      state.focusMine=false; }
    fetchVisibleEmblems(visible).then(changed=>{ if(changed) renderTable(); }).catch(()=>{});
  }
  function render(){ root.querySelectorAll("[data-cr-metric]").forEach(b=>b.classList.toggle("active",b.dataset.crMetric===state.metric)); renderOwn(); renderPodium(); renderSide(); renderTable(); }
  async function loadMetric(){
    ui.status.textContent="Chargement des données officielles…";
    ui.rows.innerHTML='<tr><td colspan="6" class="cr-empty">Chargement du classement…</td></tr>';
    try{ const [rows]=await Promise.all([fetchAllRanking(), fetchOwnRatings()]); state.rows=rows;
      ui.status.textContent="Données officielles Wargaming · actualisées"; render();
    }catch(error){ ui.status.textContent="Données officielles indisponibles"; ui.rows.innerHTML=`<tr><td colspan="6" class="cr-empty">${esc(error.message)}</td></tr>`; }
  }
  function focusMyClan(){
    const mineIndex = state.rows.slice().sort((a,b)=>a.rank-b.rank).findIndex(row=>row.clanId===CONFIG.clanId);
    if(mineIndex<0) return;
    state.query=""; state.sortKey="rank"; state.sortDir="asc"; state.page=Math.floor(mineIndex/CONFIG.pageSize)+1; state.focusMine=true; ui.search.value=""; renderTable();
  }

  ui.metric.innerHTML = METRICS.map(([k,l])=>`<option value="${k}">${esc(l)}</option>`).join("");
  ui.metric.value = state.metric;
  ui.metric.addEventListener("change",()=>{ state.metric=ui.metric.value; state.page=1; state.query=""; state.sortKey="rank"; state.sortDir="asc"; ui.search.value=""; loadMetric(); });
  root.querySelectorAll("[data-cr-metric]").forEach(button=>{ button.addEventListener("click",()=>{ state.metric=button.dataset.crMetric; ui.metric.value=state.metric; state.page=1; state.query=""; state.sortKey="rank"; state.sortDir="asc"; ui.search.value=""; loadMetric(); }); });
  ui.search.addEventListener("input",()=>{ state.query=ui.search.value; state.page=1; renderTable(); });
  root.querySelectorAll("[data-cr-sort]").forEach(button=>{ button.addEventListener("click",()=>{ const key=button.dataset.crSort;
    if(state.sortKey===key) state.sortDir=state.sortDir==="asc"?"desc":"asc"; else { state.sortKey=key; state.sortDir="desc"; }
    state.page=1; renderTable(); }); });
  ui.mine.addEventListener("click", focusMyClan);
  loadMetric();
}

/* boot() pilote le CADRE de l'application : page d'accueil publique,
   écran de connexion, barre latérale, neuf vues. La page « Ma
   progression » n'a rien de tout cela — elle fait son propre démarrage
   dans progression.js. On teste la présence de l'écran de connexion,
   qui n'existe que sur index.html. */
if (document.getElementById("loginScreen")) boot();

/* ══ Motion de l'accueil ══════════════════════════════════════════════
   Le masquage est posé par le script (classe .lmo sur <html>) : sans JS,
   la page reste entièrement visible. Filet de sécurité à 3 s. */
(function(){
  var land = document.getElementById("landing");
  if (!land) return;
  var doux = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var blocs = land.querySelectorAll(".rv2, .lsec, .lduo figure");
  var tout = function(){
    Array.prototype.forEach.call(blocs, function(b){ b.classList.add("vu"); });
  };
  if (doux || !("IntersectionObserver" in window)) { tout(); return; }
  document.documentElement.classList.add("lmo");
  // les segments du SR se remplissent l'un après l'autre
  var segs = land.querySelectorAll(".lsr-k s");
  Array.prototype.forEach.call(segs, function(x, i){ x.style.setProperty("--d", i); });
  var io = new IntersectionObserver(function(es){
    es.forEach(function(e){
      if (e.isIntersecting){ e.target.classList.add("vu"); io.unobserve(e.target); }
    });
  }, { rootMargin: "0px 0px -12% 0px", threshold: .08 });
  Array.prototype.forEach.call(blocs, function(b){ io.observe(b); });
  setTimeout(tout, 3000);

  // barre de progression de lecture
  var jauge = land.querySelector(".lprog i");
  if (jauge){
    var tick = false;
    addEventListener("scroll", function(){
      if (tick) return; tick = true;
      requestAnimationFrame(function(){
        var h = document.documentElement.scrollHeight - innerHeight;
        jauge.style.width = (h > 0 ? Math.min(100, scrollY / h * 100) : 0) + "%";
        tick = false;
      });
    }, { passive: true });
  }
})();


