/* Clan Plus — le Briefing, la page d'arrivée du joueur connecté.

   Elle répond à trois questions :
     · qu'est-ce qui m'attend ?        → Ce soir, À faire
     · comment je m'en suis sorti ?    → Depuis ta dernière visite, Ta forme
     · où en est le clan ?             → Le clan en bref, État-major
   L'ordre change avec le moment : avant l'activité, le poste passe en
   premier ; juste après, le débrief ; un soir sans activité, ce qu'il
   reste à régler. Une carte n'a sa place ici que si elle demande une
   action, apprend quelque chose de nouveau, ou mène quelque part en un
   clic. Sinon on arrête de la regarder au bout d'une semaine.

   Chargé en différé APRÈS app.js : le SR, le coach et la lecture des
   line-ups sont ceux de l'application, pas des copies qui dériveraient.

   Deux cadres :
     · index.html — une vue de l'application (#viewBriefing). openApp a
       déjà chargé les batailles ; switchView("briefing") appelle
       window.bfOuvre, et les liens changent de vue (ALLER).
     · _labo-briefing.html — la page charge tout elle-même, sur de
       fausses données ; window.BF_LIENS y redirige les liens vers les
       autres pages de labo. */
(function () {
  "use strict";

  const HOTE = document.getElementById("viewBriefing");
  if (!HOTE) return;
  /* index.html (l'écran de connexion n'existe que là) ou le labo */
  const DANS_APPLI = !!document.getElementById("loginScreen");

  const H = 3600, J = 86400;
  const LIENS = Object.assign({
    clan: "index.html", lineups: "index.html", batailles: "index.html", prio: "index.html", progression: "progression.html", lier: "mod.html",
    calendrier: "index.html", recruteur: "index.html", mod: "mod.html",
    bataille: id => "index.html?bataille=" + encodeURIComponent(id),
  }, window.BF_LIENS || {});
  const FORMAT = { bastion10: "Bastion tier X", bastion8: "Bastion tier VIII", bastion6: "Bastion tier VI", manoeuvres: "Manœuvres" };

  /* ── La langue ──
     Toute phrase passe par t() ; l'anglais vit dans i18n/briefing.en.js.
     Les valeurs se posent APRÈS la traduction, dans des trous %1, %2…
     Surtout pas {n} ni {s} : le traducteur de la page prend ces clés-là
     pour des motifs à chercher dans tout le document, et une clé aussi
     courte que « {s} à {s} » réécrirait n'importe quelle phrase
     contenant « à ». Pas de variable nommée « t » non plus dans ce
     fichier : elle masquerait la fonction de traduction. */
  const EN = window.CP_LANG === "en";
  const tr = (phrase, ...v) => (window.t ? window.t(phrase) : phrase).replace(/%(\d)/g, (_, i) => v[i - 1] == null ? "" : v[i - 1]);
  const trn = (n, un, plusieurs, ...v) => tr(n > 1 ? plusieurs : un, n, ...v);
  const PC = EN ? "%" : " %";

  /* L'état de la page. Chaque champ reste à null tant que sa requête
     n'est pas revenue : la carte qui en dépend garde son squelette. */
  const B = {
    vu: null, moment: null, officier: false,
    lu: null, ev: null, liens: null, garages: null, lo: null, prio: null,
    modv: null, offres: null, departs: null,
    clan: false, clanErr: false,
    dispoFaite: {}, dispoMsg: {}, dispoMinuteur: {},
  };

  const maintenant = () => Date.now() / 1000;
  const ic = id => `<svg class="ic" aria-hidden="true"><use href="#${id}"/></svg>`;

  /* ══ Le temps ══════════════════════════════════════════════════════ */
  function heure(ts) { return new Date(ts * 1000).toLocaleTimeString(window.CP_LOC, { hour: "2-digit", minute: "2-digit" }); }
  /* « aujourd'hui », « hier », « vendredi », « 12 oct. » : la date telle
     qu'on la dit, pas telle qu'on l'écrit sur un formulaire. */
  function jourDit(ts, avecHeure) {
    const d = new Date(ts * 1000), a = new Date();
    const ecart = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) -
                              new Date(a.getFullYear(), a.getMonth(), a.getDate())) / 864e5);
    let s;
    if (ecart === 0) s = tr(d.getHours() >= 18 ? "ce soir" : "aujourd'hui");
    else if (ecart === -1) s = tr("hier");
    else if (ecart === 1) s = tr("demain");
    else if (Math.abs(ecart) < 7) s = d.toLocaleDateString(window.CP_LOC, { weekday: "long" });
    else s = d.toLocaleDateString(window.CP_LOC, { day: "numeric", month: "short" });
    return avecHeure ? tr("%1 à %2", s, heure(ts)) : s;
  }
  function dans(s) {
    s = Math.max(0, Math.round(s));
    if (s < H) return Math.max(1, Math.round(s / 60)) + " min";
    if (s < J) { const h = Math.floor(s / H), m = Math.round((s % H) / 60); return h + " h" + (m ? " " + String(m).padStart(2, "0") : ""); }
    return tr("%1 j", Math.round(s / J));
  }
  /* « 1er », « 2e » — « 1st », « 2nd » */
  function rangDit(n) {
    if (!EN) return n + "<sup>" + (n === 1 ? "er" : "e") + "</sup>";
    const d = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[n % 10] || "th";
    return n + "<sup>" + d + "</sup>";
  }

  /* La visite précédente. Recharger la page dans la demi-heure ne compte
     pas comme une nouvelle visite : sinon « ce qui est nouveau » serait
     vidé par un simple F5. */
  function visite() {
    const n = Date.now();
    let v = null;
    try { v = JSON.parse(localStorage.getItem("cp_bf_vu") || "null"); } catch (_) { v = null; }
    if (!v || typeof v.last !== "number" || n - v.last > 30 * 60e3) v = { prev: (v && v.last) || null, last: n };
    else v.last = n;
    try { localStorage.setItem("cp_bf_vu", JSON.stringify(v)); } catch (_) { /* navigation privée */ }
    return v.prev ? Math.floor(v.prev / 1000) : null;
  }

  /* ══ Qui suis-je ═══════════════════════════════════════════════════
     clan-data le dit, mais c'est la requête la plus lourde. En attendant,
     le pseudo gardé à la connexion, retrouvé dans les line-ups. La future
     fonction serveur du briefing renverra le compte : cette devinette
     disparaîtra avec elle. */
  function moi() {
    if (ME_ID != null) return Number(ME_ID);
    const nick = String(lsGet("cp_nick") || "").toLowerCase();
    if (!nick) return null;
    for (const lu of B.lu || []) for (const s of lu.slots || [])
      if (s && s._type !== "meta" && String(s.name || "").toLowerCase() === nick) return Number(s.account_id);
    return null;
  }
  function monSlot(lu) { const me = moi(); return (lu.slots || []).find(s => s && s._type !== "meta" && Number(s.account_id) === me) || null; }
  function nomMembre(acc, lu) {
    const m = (MEMBERS || []).find(x => Number(x.account_id) === Number(acc));
    if (m) return m.nickname;
    const s = lu && (lu.slots || []).find(x => x && Number(x.account_id) === Number(acc));
    return s ? s.name : "?";
  }
  function nomChar(id) {
    if (!id) return "";
    const v = VEHMAP[Number(id)]; if (v && v.name) return v.name;
    const ch = ((LO_REF && LO_REF.tanks) || []).find(x => Number(x.tank_id) === Number(id));
    return ch ? ch.name : "";
  }
  function semaineCourante() { return luDateISO(luMonday()); }

  /* ══ L'agenda ══════════════════════════════════════════════════════ */
  const finDe = e => e.event_ts + (Number(e.duration_min) || 60) * 60;
  const agenda = () => (B.ev || []).slice().sort((a, b) => a.event_ts - b.event_ts);
  /* en cours ou à venir */
  function prochaine() { const n = maintenant(); return agenda().find(e => finDe(e) > n) || null; }
  function aVenir() { const n = maintenant(); return agenda().find(e => e.event_ts > n) || null; }
  function derniereFinie() { const n = maintenant(); return agenda().filter(e => finDe(e) <= n).pop() || null; }

  /* La composition épinglée pour ce soir (même lecture que la fonction
     « tonight » du mod). On préfère la line-up où le joueur figure. */
  function ceSoir() {
    const me = moi(), trouvees = [];
    for (const lu of B.lu || []) {
      const tn = luTonightOf(lu);
      if (!tn || !(new Date(tn.until).getTime() > Date.now())) continue;
      const comp = luCompsOf(lu).find(c => c.id === tn.comp);
      if (!comp) continue;
      const i = comp.posts.findIndex(p => me != null && Number(p.account_id) === me);
      trouvees.push({ lu, comp, format: luMeta(lu).format, i, poste: i >= 0 ? comp.posts[i] : null, dedans: !!monSlot(lu) });
    }
    return trouvees.find(x => x.poste) || trouvees.find(x => x.dedans) || trouvees[0] || null;
  }

  /* Le moment décide de l'ordre des cartes. Il ne dépend QUE des données
     légères (calendrier, line-ups) : sinon la page se réorganiserait sous
     les yeux du joueur à l'arrivée des batailles. */
  function leMoment() {
    const n = maintenant(), p = prochaine(), f = derniereFinie();
    if (p && p.event_ts - n < 14 * H) return "avant";          // avant ou pendant
    if (f && n - finDe(f) < 6 * H) return "apres";
    if (ceSoir() && new Date().getHours() >= 12) return "avant"; // compo épinglée, rien au calendrier
    return "semaine";
  }
  const PLANS = {
    avant:   [["soir", 4], ["afaire", 2], ["depuis", 4], ["forme", 2], ["clan", 3], ["em", 3]],
    apres:   [["depuis", 4], ["forme", 2], ["soir", 3], ["afaire", 3], ["clan", 3], ["em", 3]],
    semaine: [["afaire", 3], ["soir", 3], ["depuis", 4], ["forme", 2], ["clan", 3], ["em", 3]],
  };

  /* ══ Garage et setup ═══════════════════════════════════════════════ */
  function monGarage() {
    if (!B.garages) return undefined;                                 // pas encore là
    const me = moi();
    return B.garages.find(g => Number(g.account_id) === me) || null;  // null : mod pas relié
  }
  function charAuGarage(id) {
    const g = monGarage();
    if (g === undefined) return undefined;
    if (!g) return null;
    return (g.tanks || []).find(t => Number(t.id) === Number(id)) || false;
  }
  /* Setup du clan pour un char, comparé à ce que le joueur a monté.
     Équipements comparés PAR FAMILLE (un fouloir bonus vaut un fouloir),
     consommables par identifiant exact — comme la pastille du mod. */
  function setupDe(tankId) {
    const lo = (B.lo || []).find(l => Number(l.tank_id) === Number(tankId));
    if (!lo || !LO_REF) return null;
    const F = loEqFam(), em = LO_REF.equipmentMap || {};
    const fam = id => F.idFam[id] || ("id" + id);
    const nomEq = id => (F.fam[F.idFam[id]] && F.fam[F.idFam[id]].name) || (em[id] && em[id].name) || ("#" + id);
    const nomCo = id => { const c = (LO_REF.consumables || []).find(x => Number(x.id) === Number(id)); return c ? c.name : "#" + id; };
    const monte = charAuGarage(tankId);
    const eqClan = (lo.equipment || []).map(Number), coClan = (lo.consumables || []).map(Number);
    const pieces = eqClan.map(id => ({ nom: nomEq(id), ok: monte ? (monte.eq || []).some(m => fam(m) === fam(id)) : null }))
      .concat(coClan.map(id => ({ nom: nomCo(id), ok: monte ? (monte.cons || []).map(Number).includes(id) : null })));
    const enTrop = monte ? (monte.eq || []).filter(m => !eqClan.some(id => fam(id) === fam(m))).map(nomEq)
      .concat((monte.cons || []).map(Number).filter(c => !coClan.includes(c)).map(nomCo)) : [];
    return { pieces, enTrop, manque: pieces.filter(p => p.ok === false).length };
  }

  /* ══ Ce qu'il reste à faire ════════════════════════════════════════ */
  function aFaire() {
    const items = [], me = moi(), sem = semaineCourante();
    for (const lu of B.lu || []) {
      const s = monSlot(lu);
      if (!s) continue;
      const av = luAvailability(s), aJour = luMeta(lu).week_start === sem;
      const fait = B.dispoFaite[lu.id];
      if (aJour && av.some(Boolean) && !fait) continue;
      items.push({
        cle: "dispo-" + lu.id, ic: "i-cal", fait: !!fait && av.some(Boolean),
        titre: tr("Coche tes soirs — %1", esc(lu.name)),
        texte: !aJour ? tr("La semaine de cette line-up n'est pas encore ouverte : un officier doit la lancer.")
          : tr("%1 · aucun soir coché cette semaine.", tr(FORMAT[luMeta(lu).format] || "Line-up")),
        jours: aJour ? { lu: lu.id, av } : null,
      });
    }
    if (B.liens) {
      const l = B.liens.links || [], gar = B.liens.garage;
      if (!l.length) items.push({ cle: "mod", ic: "i-link", titre: tr("Relie ton jeu"),
        texte: tr("Ton poste et le setup du clan s'afficheront dans ta fenêtre de jeu, et ton garage sera vérifié tout seul."),
        lien: ["lier", tr("Relier mon jeu")] });
      else {
        const v = l.map(x => x.mod_version || "").sort(cmpVersion).pop();
        if (B.modv && v && cmpVersion(v, B.modv) < 0) items.push({ cle: "modv", ic: "i-bolt", titre: tr("Mets ton mod à jour"),
          texte: tr("Version %1 installée, %2 disponible.", esc(v), esc(B.modv)), lien: ["mod", tr("Télécharger")] });
        if (gar && gar.updated_at && Date.now() - Date.parse(gar.updated_at) > 7 * J * 1000) items.push({ cle: "garage", ic: "i-tools",
          titre: tr("Ton garage date de %1", jourDit(Date.parse(gar.updated_at) / 1000)),
          texte: tr("Lance le jeu avec le mod : il se met à jour tout seul.") });
      }
    }
    if (B.prio && monGarage() !== undefined) {
      const g = monGarage(), possede = new Set((B.prio.owned || []).map(Number));
      if (g) (g.tanks || []).forEach(x => possede.add(Number(x.id)));
      const manque = (B.prio.prio || []).map(Number).filter(id => !possede.has(id));
      if (manque.length) items.push({ cle: "prio", ic: "i-trophy",
        titre: trn(manque.length, "%1 char prioritaire du clan te manque", "%1 chars prioritaires du clan te manquent"),
        texte: manque.map(id => `<span class="bf-puce">${esc(nomChar(id) || "#" + id)}</span>`).join(" ") +
          (g ? "" : `<br><span class="bf-disc">${tr("D'après ta liste déclarée — relie ton jeu pour que ce soit automatique.")}</span>`),
        lien: ["prio", tr("Voir la liste du clan")] });
    }
    return items;
  }
  function cmpVersion(a, b) {
    const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
    return 0;
  }

  /* ══ Les batailles du joueur ═══════════════════════════════════════ */
  function mesBatailles() {
    const me = moi(), vus = new Set();
    return RAW.filter(r => r.accId === me && !vus.has(r.battleId) && vus.add(r.battleId)).sort((a, b) => b.ts - a.ts);
  }
  /* La dernière soirée : les batailles qui se suivent à moins de trois
     heures d'écart, en partant de la plus récente. */
  function derniereSoiree(mes) {
    const out = [];
    for (const r of mes) { if (out.length && out[out.length - 1].ts - r.ts > 3 * H) break; out.push(r); }
    return out;
  }
  function bilan(lot) {
    const v = lot.filter(r => r.result === 1).length, d = lot.filter(r => r.result === 0).length;
    return { n: lot.length, v, d, nul: lot.length - v - d, sr: srAvg(lot),
             dmg: lot.length ? Math.round(lot.reduce((s, r) => s + r.dmg, 0) / lot.length) : 0 };
  }
  function lotDuDebrief() {
    const mes = mesBatailles();
    const neuf = B.vu ? mes.filter(r => r.ts > B.vu) : [];
    return neuf.length ? { lot: neuf, rattrapage: false, mes } : { lot: derniereSoiree(mes), rattrapage: true, mes };
  }
  function srMoyen30(mes) {
    const n = maintenant(), l = mes.filter(r => estTierSR(r) && n - r.ts <= 30 * J);
    return l.length >= 5 ? { sr: srAvg(l), rows: l, trente: true } : { sr: srAvg(mes.filter(estTierSR)), rows: mes.filter(estTierSR), trente: false };
  }

  /* ══ Les cartes ════════════════════════════════════════════════════ */
  function tete(icone, titre, meta, badge) {
    return `<header class="bf-ch"><span class="bf-ci">${ic(icone)}</span><h2>${titre}</h2>` +
      (badge ? `<span class="bf-badge">${badge}</span>` : "") + (meta ? `<span class="bf-cm">${meta}</span>` : "") + `</header>`;
  }
  /* Un lien porte sa cible deux fois : une adresse, pour le labo et le
     clic du milieu, et une clé que l'application traduit en changement
     de vue (voir ALLER). */
  function lienHTML(cle, texte) {
    return `<a class="bf-lien" href="${esc(LIENS[cle])}" data-bf-go="${cle}">${texte}<span aria-hidden="true"> →</span></a>`;
  }
  function pied(liens) {
    const l = liens.filter(Boolean);
    return l.length ? `<footer class="bf-cf">${l.map(([cle, txt]) => lienHTML(cle, txt)).join("")}</footer>` : "";
  }
  function vide(txt) { return `<p class="bf-vide">${txt}</p>`; }
  function echecClan() {
    return `<div class="bf-err"><p>${tr("Impossible de charger les batailles du clan.")}</p><button type="button" class="bf-btn" data-bf="relance">${tr("Réessayer")}</button></div>`;
  }
  const nomCat = c => tr(c[1]);

  /* ── 1. Ce soir ── */
  function carteSoir() {
    if (!B.lu || !B.ev) return null;
    if (B.moment !== "avant") return carteProchaine();
    const tn = ceSoir(), ev = prochaine(), n = maintenant();
    const meta = ev ? esc(ev.title) + " · " + heure(ev.event_ts) : (tn ? tr(FORMAT[tn.format] || "") : "");
    let corps;
    if (!tn) corps = vide(tr("La composition de ce soir n'est pas encore publiée.")) + dispoDuSoir(ev ? ev.event_ts : n);
    else if (!tn.poste) corps = `<p class="bf-reserve"><b>${tr("Tu n'es pas dans la composition « %1 ».", esc(tn.comp.name))}</b>
      ${tr(tn.dedans ? "Tu fais partie de la line-up : reste joignable, un poste peut se libérer." : "Tu n'es pas dans cette line-up.")}</p>` + equipe(tn);
    else corps = posteHTML(tn) + equipe(tn);
    return tete("i-target", tr("Ce soir"), meta) + `<div class="bf-cb">${corps}</div>` + pied([["lineups", tr("Voir la line-up")]]);
  }
  function posteHTML(tn) {
    const p = tn.poste, c = luCat(p.cat), tank = nomChar(p.tank_id);
    const g = p.tank_id ? charAuGarage(p.tank_id) : undefined;
    const etat = g === undefined ? "" : g === null ? `<span class="bf-etat">${tr("garage inconnu — relie ton jeu")}</span>`
      : g ? `<span class="bf-etat ok">${tr("✓ dans ton garage")}</span>` : `<span class="bf-etat ko">${tr("✗ pas dans ton garage")}</span>`;
    const st = p.tank_id ? setupDe(p.tank_id) : null;
    const setup = !st ? "" : `<div class="bf-bloc"><span class="bf-k">${tr("Setup du clan")}</span>
      <ul class="bf-pieces">${st.pieces.map(x => `<li class="${x.ok === true ? "ok" : x.ok === false ? "ko" : ""}">${x.ok === true ? "✓ " : x.ok === false ? "✗ " : ""}${esc(x.nom)}</li>`).join("")}</ul>
      ${st.manque && st.enTrop.length ? `<p class="bf-disc">${tr("Monté à la place : %1.", st.enTrop.map(esc).join(", "))}</p>` : ""}
      ${st.pieces.some(x => x.ok === null) ? `<p class="bf-disc">${tr("Relie ton jeu pour comparer avec ce que tu as monté.")}</p>` : ""}</div>`;
    return `<div class="bf-soir">
      <div class="bf-poste">
        <div class="bf-pn"><b>${tn.i + 1}</b><i>/${tn.comp.posts.length}</i><span>${tr("ton poste")}</span></div>
        <div class="bf-pd"><div class="bf-pc">${luCatIco(c[0])}<b>${esc(nomCat(c))}</b></div><p>${esc(tr(c[3] || ""))}</p></div>
      </div>
      <div class="bf-bloc"><span class="bf-k">${tr("Ton char")}</span>
        <div class="bf-char"><b>${tank ? esc(tank) : tr("À ton choix")}</b>${tank ? etat : `<span class="bf-etat">${tr("dans la catégorie %1", esc(nomCat(c).toLowerCase()))}</span>`}</div></div>
      ${setup}
      ${tn.comp.note ? `<blockquote class="bf-note">${esc(tn.comp.note)}<cite>${tr("Composition « %1 »", esc(tn.comp.name))}</cite></blockquote>` : ""}
    </div>`;
  }
  function equipe(tn) {
    const me = moi(), auj = luToday(), roster = luCleanSlots(tn.lu);
    return `<div class="bf-bloc"><span class="bf-k">${tr("L'équipe")}</span><ol class="bf-equipe">${tn.comp.posts.map((p, i) => {
      if (!p.account_id) return `<li class="vide"><span>${i + 1}</span><b>${tr("à pourvoir")}</b><i>${esc(nomCat(luCat(p.cat)))}</i></li>`;
      const s = roster.find(x => Number(x.account_id) === Number(p.account_id));
      const absent = s && !s.availability[auj];
      return `<li class="${Number(p.account_id) === me ? "moi" : ""}${absent ? " absent" : ""}"${absent ? ` title="${esc(tr("N'a pas coché ce soir"))}"` : ""}><span>${i + 1}</span><b>${Number(p.account_id) === me ? tr("Toi") : esc(nomMembre(p.account_id, tn.lu))}</b><i>${esc(nomChar(p.tank_id) || nomCat(luCat(p.cat)))}</i></li>`;
    }).join("")}</ol></div>`;
  }
  /* « Je serai là » pour un soir donné, dans chaque line-up du joueur
     dont la semaine couvre ce soir-là. */
  function dispoDuSoir(ts) {
    const d = new Date(ts * 1000), j = (d.getDay() + 6) % 7, sem = luDateISO(luMonday(luDateISO(d)));
    const out = [];
    for (const lu of B.lu || []) {
      const s = monSlot(lu);
      if (!s || luMeta(lu).week_start !== sem) continue;
      const on = luAvailability(s)[j];
      out.push(`<div class="bf-dispo"><span>${esc(lu.name)}</span>
        <button type="button" class="bf-j bf-j-large${on ? " on" : ""}" data-lu="${esc(String(lu.id))}" data-j="${j}" aria-pressed="${on}">${tr(on ? "✓ Disponible" : "Je serai là")}</button>
        ${B.dispoMsg[lu.id] ? `<span class="bf-msg">${B.dispoMsg[lu.id]}</span>` : ""}</div>`);
    }
    return out.join("");
  }
  /* ── 1 bis. Prochaine activité (après l'activité, ou un soir sans) ── */
  function carteProchaine() {
    const p = aVenir(), n = maintenant();
    if (!p) return tete("i-cal", tr("Prochaine activité")) + `<div class="bf-cb">${vide(tr("Rien au calendrier pour l'instant. Les officiers y publient les soirées."))}</div>` + pied([["calendrier", tr("Calendrier")]]);
    return tete("i-cal", tr("Prochaine activité"), tr("dans %1", dans(p.event_ts - n))) + `<div class="bf-cb">
      <div class="bf-prox"><b>${esc(p.title)}</b><span>${capFirst(jourDit(p.event_ts, true))}</span>${p.notes ? `<p>${esc(p.notes)}</p>` : ""}</div>
      ${dispoDuSoir(p.event_ts)}</div>` + pied([["calendrier", tr("Calendrier")]]);
  }

  /* ── 2. À faire ── */
  /* les initiales des jours, du lundi au dimanche, dans la langue du lecteur */
  const JOURS = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(window.CP_LOC, { weekday: "narrow" }).toUpperCase());
  function carteAFaire() {
    if (!B.lu) return null;
    const items = aFaire(), restants = items.filter(x => !x.fait).length, auj = luToday();
    const liste = items.length ? `<ul class="bf-todo">${items.map(x => `<li class="${x.fait ? "fait" : ""}">
        <span class="bf-tc">${ic(x.fait ? "i-check" : x.ic)}</span>
        <div class="bf-tt"><b>${x.titre}</b><p>${x.fait ? tr("Enregistré. Tu pourras les changer dans Line-ups.") : x.texte}</p>
          ${x.jours ? `<div class="bf-jours" role="group" aria-label="${esc(tr("Tes soirs de la semaine"))}">${x.jours.av.map((on, i) =>
            `<button type="button" class="bf-j${on ? " on" : ""}${i === auj ? " auj" : ""}" data-lu="${esc(String(x.jours.lu))}" data-j="${i}" aria-pressed="${on}" aria-label="${esc(capFirst(new Date(2024, 0, 1 + i).toLocaleDateString(window.CP_LOC, { weekday: "long" })))}"${i === auj ? ` title="${esc(tr("Ce soir"))}"` : ""}>${JOURS[i]}</button>`).join("")}
            ${B.dispoMsg[x.jours.lu] ? `<span class="bf-msg">${B.dispoMsg[x.jours.lu]}</span>` : ""}</div>` : ""}
          ${x.lien && !x.fait ? lienHTML(x.lien[0], x.lien[1]) : ""}</div></li>`).join("")}</ul>`
      : `<div class="bf-pret">${ic("i-check")}<b>${tr("Rien à faire.")}</b><span>${tr("Tu es prêt pour la prochaine activité.")}</span></div>`;
    const charge = !B.liens || !B.prio || B.garages === null;
    return tete("i-check", tr("À faire"), charge ? tr("vérification…") : "", restants || "") + `<div class="bf-cb">${liste}</div>`;
  }

  /* ── 3. Depuis ta dernière visite ── */
  function carteDepuis() {
    if (B.clanErr) return tete("i-swords", tr("Depuis ta dernière visite")) + echecClan();
    if (!B.clan) return null;
    const { lot, rattrapage, mes } = lotDuDebrief();
    const titre = tr(B.moment === "apres" && !rattrapage ? "Ta soirée" : (rattrapage ? "Ta dernière soirée" : "Depuis ta dernière visite"));
    if (!mes.length) return tete("i-swords", titre) + `<div class="bf-cb">${vide(tr("Aucune bataille enregistrée pour toi. Elles arrivent ici dès que tu joues une bataille de clan avec le mod."))}</div>`;
    const meta = rattrapage ? (B.vu ? tr("rien de neuf depuis %1", jourDit(B.vu)) : jourDit(lot[0].ts)) : (B.vu ? tr("depuis %1", jourDit(B.vu, true)) : "");
    const b = bilan(lot), ref = srMoyen30(mes).sr, palier = ceTier(b.sr);
    const ecart = b.sr != null && ref != null ? b.sr - ref : null;
    /* V / D : les lettres du bilan, qu'un dictionnaire ne peut pas porter
       (une clé « V » traduirait aussi le vendredi des soirs à cocher) */
    const [lV, lD, lN] = EN ? ["W", "L", "D"] : ["V", "D", "N"];
    const tuiles = `<div class="bf-tuiles">
      <div><span>${tr("Batailles")}</span><b>${b.n}</b></div>
      <div><span>${tr("Bilan")}</span><b><em class="v">${b.v} ${lV}</em> · <em class="d">${b.d} ${lD}</em>${b.nul ? ` · ${b.nul} ${lN}` : ""}</b></div>
      <div><span>${tr("Ton SR moyen")}</span><b style="color:${palier.c}">${b.sr == null ? "—" : fmt(b.sr)}</b>${ecart != null && Math.abs(ecart) >= 10 ? `<i class="${ecart > 0 ? "up" : "dn"}">${tr(ecart > 0 ? "▲ %1 au-dessus de ta moyenne" : "▼ %1 sous ta moyenne", fmt(Math.abs(ecart)))}</i>` : ""}</div>
      <div><span>${tr("Dégâts moyens")}</span><b>${fmt(b.dmg)}</b></div></div>`;
    const plus = lot.length > 5 ? `<p class="bf-disc">${trn(lot.length - 5, "Et %1 autre bataille.", "Et %1 autres batailles.")}</p>` : "";
    /* Peu de nouveau : on complète avec ce qui précède, en retrait, pour
       que le bilan se lise avec son contexte. */
    const avant = !rattrapage && lot.length < 5 ? mes.filter(r => r.ts <= lot[lot.length - 1].ts && !lot.includes(r)).slice(0, 5 - lot.length) : [];
    const ligne = r => {
      const sr = srBattle(r), pal = ceTier(sr);
      const res = r.result === 1 ? ["v", tr("Victoire"), lV] : r.result === 0 ? ["d", tr("Défaite"), lD] : ["n", tr("Nul"), lN];
      return `<li><a class="bf-b ${res[0]}" href="${esc(LIENS.bataille(r.battleId))}" data-bf-go="bataille" data-bf-id="${esc(String(r.battleId))}">
        <span class="bf-bm">${dashMapThumb(r.mapName)}</span>
        <span class="bf-bi"><b>${esc(prettyMap(r.mapName))}</b><i>${jourDit(r.ts, true)}</i></span>
        <span class="bf-bt">${esc(r.tank || tr("Char inconnu"))}<i>${trn(r.kills, "%2 dég. · %1 frag", "%2 dég. · %1 frags", fmt(r.dmg))}</i></span>
        <span class="bf-br"><span class="bf-br-l">${res[1]}</span><span class="bf-br-c" aria-hidden="true">${res[2]}</span></span>
        <span class="bf-sr" style="color:${pal.c}" title="${esc(tr("SR de la bataille — %1", tr(pal.l)))}"><i>SR</i>${sr == null ? "—" : fmt(sr)}</span></a></li>`;
    };
    return tete("i-swords", titre, meta) + `<div class="bf-cb">${tuiles}<ol class="bf-bl">${lot.slice(0, 5).map(ligne).join("")}</ol>${plus}` +
      (avant.length ? `<span class="bf-k bf-avant">${tr("Plus tôt")}</span><ol class="bf-bl bf-bl-avant">${avant.map(ligne).join("")}</ol>` : "") +
      `</div>` + pied([["batailles", tr("Toutes mes batailles")]]);
  }

  /* ── 4. Ta forme ── */
  /* Une seule chose à travailler, prise au coach de Ma progression : la
     première de ses missions. S'il n'en a pas, un recul récent à
     surveiller ; sinon le point fort — pour ne pas laisser la carte muette. */
  function mission(my, clanRows) {
    SELP = moi();                                 // coachDiag compare au clan SANS le joueur
    const d = coachDiag(my, clanRows);
    const tri = my.slice().sort((a, b) => b.ts - a.ts), rec = tri.slice(0, 10), avant = tri.slice(10);
    const fm = g => v => g.u === "%" ? Math.round(v * 100) + PC : (g.u === "s" ? Math.round(v) + " s" : v.toLocaleString(window.CP_LOC, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    for (const g of d.retards) {
      const dep = g.calc(avant);
      if (!dep || !(dep.v < g.c)) continue;
      const base = dep.v, cible = base + (g.c - base) / 2, r = g.calc(rec), now = r ? r.v : null;
      const av = now == null ? 0 : Math.max(0, Math.min(100, (cible - base) ? (now - base) / (cible - base) * 100 : 100));
      return { type: "mission", g, base, cible, now, av, fait: now != null && now >= cible, f: fm(g) };
    }
    /* sous le clan, mais seulement depuis peu : pas de mission (elle
       demanderait de reculer), c'est une alerte */
    for (const g of d.retards) {
      const a = g.calc(avant), r = g.calc(rec);
      if (a && r && r.v < a.v) return { type: "recul", g, avant: a.v, now: r.v, f: fm(g) };
    }
    const g = d.forts[0];
    return g ? { type: "fort", g, texte: g.constat ? g.constat(g.m, g.c) : "" } : null;
  }
  function missionHTML(ms) {
    if (!ms) return "";
    if (ms.type === "fort") return `<div class="bf-mis"><div class="bf-mis-h"><span class="bf-k">${tr("Ton point fort")}</span><b>${esc(tr(ms.g.nom))}</b><em class="up">▲</em></div>
      <p>${esc(tr(ms.texte))}</p></div>`;
    if (ms.type === "recul") return `<div class="bf-mis"><div class="bf-mis-h"><span class="bf-k">${tr("À surveiller")}</span><b>${esc(tr(ms.g.nom))}</b><em class="dn">${tr("▼ en recul")}</em></div>
      <p>${tr("Sur tes 10 dernières : <b>%1</b>, contre <b>%2</b> avant.", ms.f(ms.now), ms.f(ms.avant))}</p><p class="bf-disc">${esc(tr(ms.g.action))}</p></div>`;
    return `<div class="bf-mis${ms.fait ? " ok" : ""}"><div class="bf-mis-h"><span class="bf-k">${tr("Ta mission")}</span><b>${esc(tr(ms.g.nom))}</b><em>${ms.fait ? tr("✓ réussie") : Math.round(ms.av) + PC}</em></div>
      <div class="bf-jauge"><i style="width:${ms.av.toFixed(1)}%"></i></div>
      <p>${tr("Passer de <b>%1</b> à <b>%2</b>", ms.f(ms.base), ms.f(ms.cible))}${ms.now != null ? tr(" · sur tes 10 dernières : <b>%1</b>", ms.f(ms.now)) : ""}</p>
      <p class="bf-disc">${esc(tr(ms.g.action))}</p></div>`;
  }
  function spark(vals, ref) {
    if (vals.length < 3) return "";
    const W = 200, Hh = 44, all = vals.concat(ref != null ? [ref] : []);
    const lo = Math.min(...all) - 40, hi = Math.max(...all) + 40, y = v => Hh - (v - lo) / (hi - lo) * Hh, x = i => i / (vals.length - 1) * W;
    const pts = vals.map((v, i) => x(i).toFixed(1) + "," + y(v).toFixed(1)).join(" ");
    return `<svg class="bf-spark" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" aria-hidden="true">
      ${ref != null ? `<line class="ref" x1="0" x2="${W}" y1="${y(ref).toFixed(1)}" y2="${y(ref).toFixed(1)}"/>` : ""}
      <polyline points="${pts}"/></svg>`;
  }
  function carteForme() {
    if (B.clanErr) return tete("i-chart", tr("Ta forme")) + echecClan();
    if (!B.clan) return null;
    const mes = mesBatailles(), f = srMoyen30(mes), me = moi();
    if (f.rows.length < 5) return tete("i-chart", tr("Ta forme")) + `<div class="bf-cb">${vide(tr("Il faut au moins cinq batailles de rang X pour mesurer ta forme."))}</div>`;
    const palier = ceTier(f.sr), clan = dashStats(dashFilterRows(f.trente ? 30 : 0));
    const ecart = clan.sr != null && f.sr != null ? f.sr - clan.sr : null;
    const wr = battlesWinrate(f.rows), dmg = Math.round(avgOf(f.rows, "dmg"));
    const cmp = (a, b, pts) => { const d = a - b; return Math.abs(d) < (pts ? 0.5 : 1) ? `<i>${tr("comme le clan")}</i>`
      : `<i class="${d > 0 ? "up" : "dn"}">${tr(d > 0 ? (pts ? "▲ %1 pts au-dessus du clan" : "▲ %1 au-dessus du clan") : (pts ? "▼ %1 pts en dessous du clan" : "▼ %1 en dessous du clan"),
          pts ? Math.abs(d).toFixed(0) : fmt(Math.abs(d)))}</i>`; };
    /* le rang dans le clan : le classement de la Vue clan, mêmes règles
       d'affichage (pas de rang sous dix batailles) */
    const sp = srByPlayer(), classes = [...sp.entries()].filter(([acc, v]) => v.etat !== "insuffisant" && MEMBERSET.has(acc)).sort((a, b) => b[1].sr - a[1].sr);
    const rang = classes.findIndex(([acc]) => acc === me);
    const vals = f.rows.slice(0, 20).reverse().map(srBattle).filter(v => v != null);
    const ms = mission(mes.filter(estTierSR), RAW.filter(r => r.isMember && estTierSR(r)));
    return tete("i-chart", tr("Ta forme"), tr(f.trente ? "30 derniers jours" : "toute la saison")) + `<div class="bf-cb">
      <div class="bf-sr-g"><div><b style="color:${palier.c}">${f.sr == null ? "—" : fmt(f.sr)}</b><span>${tr("ton SR · %1", esc(tr(palier.l)))}</span>
        ${ecart != null ? `<i class="${ecart >= 0 ? "up" : "dn"}">${tr(ecart >= 0 ? "▲ %1 au-dessus du clan" : "▼ %1 en dessous du clan", fmt(Math.abs(ecart)))}</i>` : ""}</div>
        ${spark(vals, clan.sr)}</div>
      <div class="bf-duo"><div><span>${tr("Dégâts moyens")}</span><b>${fmt(dmg)}</b>${cmp(dmg, clan.dmg)}</div>
        <div><span>${tr("Victoires")}</span><b>${Math.round(wr.wr * 100)}${PC}</b>${cmp(wr.wr * 100, clan.winrate * 100, true)}</div></div>
      ${rang >= 0 ? `<p class="bf-rang">${tr("Tu es <b>%1</b> du clan au SR de la saison, sur %2 joueurs classés.", rangDit(rang + 1), classes.length)}</p>` : ""}
      ${missionHTML(ms)}
    </div>` + pied([DEV && ["progression", tr("Ma progression")]]);
  }

  /* ── 5. Le clan en bref ── */
  function carteClan() {
    if (B.clanErr) return tete("i-shield", tr("Le clan en bref")) + echecClan();
    if (!B.clan) return null;
    const n = maintenant(), cote = CLANRATINGS && CLANRATINGS.fb_elo_rating;
    const s7 = dashStats(dashFilterRows(7)), p7 = dashStats(dashFilterRows(7, true));
    const dwr = s7.tot && p7.tot ? Math.round((s7.winrate - p7.winrate) * 100) : null;
    const nouveaux = (MEMBERS || []).filter(m => m.joined_at && n - m.joined_at < 14 * J);
    /* le meilleur SR de la semaine, à partir de trois batailles */
    const par = new Map();
    dashFilterRows(7).filter(estTierSR).forEach(r => { const v = srBattle(r); if (v == null) return; const a = par.get(r.accId) || []; a.push(v); par.set(r.accId, a); });
    const top = [...par.entries()].filter(([, v]) => v.length >= 3).map(([acc, v]) => [acc, v.reduce((a, b) => a + b, 0) / v.length]).sort((a, b) => b[1] - a[1])[0];
    const tuile = (l, v, s) => `<div><span>${l}</span><b>${v}</b>${s || ""}</div>`;
    return tete("i-shield", tr("Le clan en bref"), CLANINFO ? "[" + esc(CLANINFO.tag || "") + "]" : "") + `<div class="bf-cb"><div class="bf-tuiles bf-t2">
      ${cote ? tuile(tr("Cote Bastion"), fmt(cote.value), `<i>${tr("rang %1", fmt(cote.rank))}${cote.rank_delta ? ` <em class="${cote.rank_delta > 0 ? "up" : "dn"}">${cote.rank_delta > 0 ? "▲" : "▼"}${Math.abs(cote.rank_delta)}</em>` : ""}</i>`) : ""}
      ${tuile(tr("7 derniers jours"), s7.battles ? Math.round(s7.winrate * 100) + PC : "—",
        `<i>${trn(s7.battles, "%1 bataille", "%1 batailles")}${dwr ? ` · <em class="${dwr > 0 ? "up" : "dn"}">${dwr > 0 ? "▲" : "▼"} ${Math.abs(dwr)} pts</em>` : ""}</i>`)}
      ${top ? tuile(tr("Meilleur SR de la semaine"), fmt(Math.round(top[1])), `<i>${esc(nomMembre(top[0]))}</i>`) : ""}
      ${tuile(tr("Nouveaux"), nouveaux.length || "—", nouveaux.length ? `<i>${nouveaux.slice(0, 3).map(m => esc(m.nickname)).join(", ")}</i>` : `<i>${tr("personne ces 14 jours")}</i>`)}
    </div></div>` + pied([["clan", tr("Vue clan")]]);
  }

  /* ── 6. État-major ── */
  function carteEM() {
    if (!B.lu) return null;
    const lignes = [], auj = luToday(), sem = semaineCourante(), ev = prochaine();
    /* ce soir : postes vides et joueurs placés qui n'ont pas coché ce soir */
    let pin = null;
    for (const lu of B.lu) { const tn = luTonightOf(lu); if (tn && new Date(tn.until).getTime() > Date.now()) { const c = luCompsOf(lu).find(x => x.id === tn.comp); if (c) { pin = { lu, c }; break; } } }
    if (pin) {
      const roster = luCleanSlots(pin.lu), posts = pin.c.posts;
      const vides = posts.map((p, i) => [p, i]).filter(([p]) => !p.account_id);
      const absents = posts.map((p, i) => [p, i]).filter(([p]) => { const s = p.account_id && roster.find(x => Number(x.account_id) === Number(p.account_id)); return s && !s.availability[auj]; });
      const pb = vides.map(([p, i]) => tr("poste %1 (%2) à pourvoir", i + 1, esc(nomCat(luCat(p.cat)).toLowerCase())))
        .concat(absents.map(([p, i]) => tr("%1 (poste %2) n'a pas coché ce soir", esc(nomMembre(p.account_id, pin.lu)), i + 1)));
      lignes.push({ alerte: pb.length > 0, ic: "i-target", titre: tr("Ce soir : %1 postes sur %2 pourvus", posts.length - vides.length, posts.length),
        texte: pb.length ? capFirst(pb.join(" · ")) + "." : tr("Tout le monde est placé et disponible."), lien: ["lineups", tr("Compo")] });
    } else if (B.moment === "avant" && ev) {
      lignes.push({ alerte: true, ic: "i-target", titre: tr("Aucune composition épinglée pour ce soir"),
        texte: tr("%1 à %2. Les joueurs reliés verront leur poste dans le jeu dès qu'elle l'est.", esc(ev.title), heure(ev.event_ts)), lien: ["lineups", tr("Line-ups")] });
    }
    /* dispos de la semaine : qui n'a rien coché */
    for (const lu of B.lu) {
      if (luMeta(lu).week_start !== sem) continue;
      const rien = luCleanSlots(lu).filter(s => s.account_id !== "" && !s.availability.some(Boolean) && Number(s.account_id) !== moi());
      if (rien.length) lignes.push({ alerte: true, ic: "i-cal",
        titre: trn(rien.length, "%2 : %1 joueur sans aucun soir coché", "%2 : %1 joueurs sans aucun soir coché", esc(lu.name)),
        texte: rien.slice(0, 3).map(s => esc(nomMembre(s.account_id, lu))).join(", ") + (rien.length > 3 ? tr(" et %1 autres", rien.length - 3) : "") + ".", lien: ["lineups", tr("Relancer")] });
    }
    if (B.offres && Array.isArray(B.offres.offers)) {
      const act = B.offres.offers.filter(o => o.status === "active" && !o.expired);
      const bientot = act.filter(o => Date.parse(o.expires_at) - Date.now() < 7 * J * 1000).sort((a, b) => Date.parse(a.expires_at) - Date.parse(b.expires_at))[0];
      lignes.push({ alerte: !act.length || !!bientot, ic: "i-users",
        titre: act.length ? trn(act.length, "%1 annonce de recrutement en ligne", "%1 annonces de recrutement en ligne") : tr("Aucune annonce de recrutement en ligne"),
        texte: bientot ? tr("« %1 » expire dans %2 : un clic la prolonge.", esc(bientot.title || tr("Sans titre")), dans(Date.parse(bientot.expires_at) / 1000 - maintenant()))
          : tr(act.length ? "Aucune n'expire cette semaine." : "Les joueurs qui cherchent un clan ne vous voient pas."),
        lien: ["recruteur", tr("Espace recruteur")] });
    }
    if (B.departs && Array.isArray(B.departs.rows) && B.departs.rows.length) {
      const r = B.departs.rows;
      lignes.push({ alerte: false, ic: "i-user", titre: trn(r.length, "%1 joueur solide vient de quitter son clan", "%1 joueurs solides viennent de quitter leur clan"),
        texte: r.slice(0, 2).map(x => tr(x.new_clan_id ? "<b>%1</b> (WN8 %2, parti chez [%3])" : "<b>%1</b> (WN8 %2, sans clan)", esc(x.nickname), fmt(x.wn8), esc(x.new_clan_tag || "?"))).join(" · "),
        lien: ["recruteur", tr("Sorties de clan")] });
    }
    const corps = lignes.length ? `<ul class="bf-em">${lignes.map(l => `<li class="${l.alerte ? "alerte" : ""}">
        <span class="bf-tc">${ic(l.ic)}</span><div class="bf-tt"><b>${l.titre}</b><p>${l.texte}</p></div>
        ${lienHTML(l.lien[0], l.lien[1])}</li>`).join("")}</ul>`
      : vide(tr("Rien à signaler pour l'état-major."));
    return tete("i-flag", tr("État-major"), tr("visible des officiers")) + `<div class="bf-cb">${corps}</div>`;
  }

  const CARTES = { soir: carteSoir, afaire: carteAFaire, depuis: carteDepuis, forme: carteForme, clan: carteClan, em: carteEM };

  /* ══ Le verdict : la phrase du jour ════════════════════════════════
     Le composant .vd des autres vues : un titre, une phrase, un chiffre. */
  function vdHTML(titre, phrase, chiffre, legende, barres) {
    return `<div class="vd-haut"><div class="vd-g">
        <p class="bf-kick">${tr("Briefing")} · ${capFirst(new Date().toLocaleDateString(window.CP_LOC, { weekday: "long", day: "numeric", month: "long" }))}</p>
        <h1 class="vd-t">${titre}</h1><p class="vd-p">${phrase}</p></div>
      ${chiffre ? `<div class="vd-n"><b>${chiffre}</b><i>${legende}</i>${barres || ""}</div>` : ""}</div>`;
  }
  function verdict() {
    const n = maintenant();
    if (B.moment === "apres") {
      if (B.clanErr) return vdHTML(tr("Soirée terminée"), tr("Les batailles n'ont pas pu être chargées."), "", "");
      if (!B.clan) return null;
      const { lot, rattrapage } = lotDuDebrief();
      if (rattrapage || !lot.length) {
        const p = aVenir();
        return vdHTML(tr("Soirée terminée"), tr("Tu n'as pas joué de bataille de clan ce soir.") + (p ? tr(" Prochaine activité : <b>%1</b>.", jourDit(p.event_ts, true)) : ""), "", "");
      }
      const b = bilan(lot), ref = srMoyen30(mesBatailles()).sr, ecart = b.sr != null && ref != null ? b.sr - ref : null;
      const best = lot.slice().sort((x, y) => (srBattle(y) || 0) - (srBattle(x) || 0))[0];
      const wr = b.v + b.d ? Math.round(b.v / (b.v + b.d) * 100) : 0;
      const barres = `<div class="vd-f">${lot.slice(0, 10).reverse().map((r, i) => `<i class="${r.result === 1 ? "v" : "d"}" style="--i:${i};height:${r.result === 1 ? 100 : 55}%"></i>`).join("")}</div>`;
      const comparaison = ecart != null && Math.abs(ecart) >= 10
        ? tr(ecart > 0 ? ", <span class=\"up\">▲ %1</span> au-dessus de ta moyenne" : ", <span class=\"dn\">▼ %1</span> en dessous de ta moyenne", fmt(Math.abs(ecart)))
        : tr(", dans ta moyenne");
      return vdHTML(trn(b.v, "Soirée terminée : <em>%1 victoire</em> sur %2", "Soirée terminée : <em>%1 victoires</em> sur %2", b.n),
        tr("Ton SR moyen ce soir : <b>%1</b>", b.sr == null ? "—" : fmt(b.sr)) + comparaison +
        tr(". Meilleure partie : <b>%1</b> en %2, %3 dégâts.", esc(prettyMap(best.mapName)), esc(best.tank || "?"), fmt(best.dmg)),
        wr + PC, tr("de victoires ce soir"), barres);
    }
    if (!B.lu || !B.ev) return null;
    if (B.moment === "avant") {
      const ev = prochaine(), tn = ceSoir();
      const chiffre = ev ? (ev.event_ts > n ? dans(ev.event_ts - n) : tr("en cours")) : "";
      const legende = ev && ev.event_ts > n ? tr("avant le début") : "";
      const quoi = ev ? tr("%1 à <b>%2</b>", esc(ev.title), heure(ev.event_ts)) : esc(tr(FORMAT[tn && tn.format] || "La soirée"));
      if (tn && tn.poste) {
        const tank = nomChar(tn.poste.tank_id), g = tn.poste.tank_id ? charAuGarage(tn.poste.tank_id) : undefined, st = tn.poste.tank_id ? setupDe(tn.poste.tank_id) : null;
        const soucis = [];
        if (g === false) soucis.push(tr("ce char n'est pas dans ton garage"));
        if (st && st.manque) soucis.push(trn(st.manque, "%1 pièce du setup du clan manque sur ton char", "%1 pièces du setup du clan manquent sur ton char"));
        const fin = soucis.length ? " " + capFirst(soucis.join(EN ? ", and " : ", et ")) + "."
          : g ? tr(" Ton char est au garage et monté comme le veut le clan : tu es prêt.") : "";
        return vdHTML(tank ? tr("Ce soir, <em>poste %1</em> en %2", tn.i + 1, esc(tank)) : tr("Ce soir, <em>poste %1</em>", tn.i + 1),
          tr("%1, composition « %2 ».", quoi, esc(tn.comp.name)) + fin, chiffre, legende);
      }
      if (tn) return vdHTML(tr("Ce soir, <em>tu es en réserve</em>"), tr("%1. La composition « %2 » est publiée sans toi : reste joignable, un poste peut se libérer.", quoi, esc(tn.comp.name)), chiffre, legende);
      return vdHTML(tr("Ce soir, <em>%1</em>", ev ? esc(ev.title) : "Bastion"),
        (ev ? tr("À <b>%1</b>. ", heure(ev.event_ts)) : "") + tr("La composition n'est pas encore publiée : les officiers la préparent."), chiffre, legende);
    }
    const p = aVenir(), reste = aFaire().filter(x => !x.fait).length;
    if (!p) return vdHTML(tr("Rien au calendrier"), tr("Aucune activité programmée pour l'instant.") + (reste ? " " + trn(reste, "%1 chose à régler en attendant.", "%1 choses à régler en attendant.") : ""), "", "");
    return vdHTML(tr("Prochaine activité <em>%1</em>", jourDit(p.event_ts)),
      tr("%1 à <b>%2</b>. ", esc(p.title), heure(p.event_ts)) + (reste ? trn(reste, "%1 chose à régler d'ici là.", "%1 choses à régler d'ici là.") : tr("Tout est en ordre de ton côté.")),
      dans(p.event_ts - n), tr("avant la prochaine activité"));
  }

  /* ══ Le rendu ══════════════════════════════════════════════════════ */
  const SQUELETTE = `<div class="bf-sk" aria-hidden="true"><i></i><i></i><i></i></div>`;
  function squelette() {
    HOTE.innerHTML = `<section class="vd bf-vd" id="bfVd" aria-busy="true">${SQUELETTE}</section>
      <div class="bf-g" id="bfG">${PLANS.avant.map(([k, w]) => `<article class="bf-c bf-w${w}">${SQUELETTE}</article>`).join("")}</div>`;
  }
  /* La grille se construit UNE fois, quand le moment est connu. Ensuite
     chaque arrivée de données ne remplit que l'intérieur des cartes :
     rien ne bouge de place. */
  function construit() {
    let plan = PLANS[B.moment].filter(([k]) => k !== "em" || B.officier);
    if (!B.officier) plan = plan.map(([k, w]) => [k, k === "clan" ? 6 : w]);
    B.plan = B.moment + (B.officier ? "+em" : "");
    document.getElementById("bfG").innerHTML = plan.map(([k, w], i) =>
      `<article class="bf-c bf-w${w} dash-anim${k === "soir" && B.moment === "avant" ? " bf-lumiere" : ""}" style="--di:${i + 1}" id="bf-${k}" aria-busy="true">${SQUELETTE}</article>`).join("");
  }
  function rafraichir() {
    const vd = document.getElementById("bfVd");
    if (vd && B.moment) { const h = verdict(); if (h != null) { vd.innerHTML = h; vd.removeAttribute("aria-busy"); } }
    if (!B.moment) return;
    for (const k in CARTES) {
      const el = document.getElementById("bf-" + k);
      if (!el) continue;
      const h = CARTES[k]();
      if (h != null) { el.innerHTML = h; el.removeAttribute("aria-busy"); }
    }
  }

  /* ── Les soirs cochés depuis le briefing ──
     L'action « attendance » existe déjà : un membre ne modifie que SA
     ligne. On envoie 0,6 s après le dernier clic pour grouper les clics. */
  function appel(fn, corps) {
    return fnCall(fn, Object.assign({ session: lsGet(LS_SESSION) }, corps || {})).catch(() => ({ ok: false, status: 0, j: null }));
  }
  /* Dans l'application, un lien change de vue au lieu de recharger la
     page (et de relire toutes les batailles du clan). Dans le labo, ces
     fonctions n'ont pas de vue où s'appliquer : le lien suit son adresse. */
  const ALLER = {
    clan: () => switchView("clan"),
    calendrier: () => { switchView("clan"); switchClanSub("cal"); },
    lineups: () => switchView("lineups"),
    prio: () => { switchView("loadouts"); switchLoSub("prio"); },
    batailles: () => { switchView("battles"); setBlScope("mine"); },
    recruteur: () => switchView("recruit"),
    lier: () => openLinkGame(),
    bataille: id => { try { sessionStorage.setItem(OPEN_BATTLE_KEY, id); } catch (_) { /* rien */ } openBattleFromLink(); },
  };
  HOTE.addEventListener("click", e => {
    if (e.target.closest("[data-bf=relance]")) { chargeClan(); return; }
    const a = e.target.closest("[data-bf-go]");
    if (a && DANS_APPLI && ALLER[a.dataset.bfGo] && e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      ALLER[a.dataset.bfGo](a.dataset.bfId);
      if (a.dataset.bfGo !== "lier" && a.dataset.bfGo !== "bataille") window.scrollTo(0, 0);
      /* le titre de la barre du haut suit la vue : app-fin.js le met à jour
         sur un clic dans le menu, qu'on lui signale donc */
      const nav = document.getElementById("nav");
      if (nav) nav.dispatchEvent(new Event("click"));
      return;
    }
    const b = e.target.closest(".bf-j");
    if (!b) return;
    const lu = (B.lu || []).find(x => String(x.id) === b.dataset.lu), s = lu && monSlot(lu);
    if (!s) return;
    const av = luAvailability(s), j = Number(b.dataset.j);
    av[j] = !av[j];
    s.availability = av;
    B.dispoFaite[lu.id] = true;
    B.dispoMsg[lu.id] = "…";
    rafraichir();
    clearTimeout(B.dispoMinuteur[lu.id]);
    B.dispoMinuteur[lu.id] = setTimeout(async () => {
      const r = await appel("lineups", { action: "attendance", id: lu.id, availability: av });
      B.dispoMsg[lu.id] = tr(r.ok ? "✓ Enregistré" : "Échec de l'envoi — réessaie");
      rafraichir();
    }, 600);
  });

  /* ══ Le démarrage ══════════════════════════════════════════════════ */
  async function chargeClan() {
    B.clanErr = false; rafraichir();
    let res = null;
    for (let n = 1; n <= 3; n++) {
      res = await appel("clan-data");
      if (res.ok || res.status === 401) break;
      if (n < 3) await new Promise(r => setTimeout(r, n * 1200));
    }
    if (!res || !res.ok) { B.clanErr = true; rafraichir(); return; }
    buildRaw(res.j);
    srInit(res.j);
    MEMBERS = res.j.members || [];
    ME_ID = res.j.me ? res.j.me.account_id : null;
    CLANINFO = res.j.clanInfo || null;
    CLANRATINGS = res.j.clanRatings || null;
    const clan = res.j.clan || {}, who = document.getElementById("who"), sub = document.getElementById("clanSub");
    if (sub && clan.tag) sub.textContent = "[" + clan.tag + "] " + (clan.name || "");
    if (who && res.j.me) who.innerHTML = '<span class="odot on"></span>Connecté&nbsp;<b>' + esc(res.j.me.nickname || "") + "</b>";
    B.clan = true;
    rafraichir();
  }
  /* Les données légères : relues à chaque ouverture de la vue — un soir
     coché dans Line-ups, une compo épinglée entre-temps doivent se voir
     ici. La grille n'est reconstruite que si le moment a changé. */
  function chargeLeger() {
    const fin = f => r => { f(r); rafraichir(); };
    Promise.all([appel("lineups", { action: "list" }), appel("clan-events", { action: "list" })]).then(([l, e]) => {
      B.lu = l.ok && l.j && Array.isArray(l.j.lineups) ? l.j.lineups : [];
      B.ev = e.ok && e.j && Array.isArray(e.j.events) ? e.j.events : [];
      /* officier : le droit d'éditer les line-ups, rendu par le serveur */
      B.officier = !!(l.ok && l.j && l.j.canEdit);
      B.moment = leMoment();
      if (B.plan !== B.moment + (B.officier ? "+em" : "")) construit();
      rafraichir();
      if (B.officier) {
        appel("clan-offers", { action: "mine" }).then(fin(r => { B.offres = r.ok ? r.j : null; }));
        appel("clan-departures", { action: "list", f: { days: 2, wn8: 2000 } }).then(fin(r => { B.departs = r.ok ? r.j : null; }));
      }
    });
    appel("mod", { action: "links" }).then(fin(r => { B.liens = r.ok && r.j ? r.j : { links: [], garage: null }; }));
    appel("mod", { action: "garages" }).then(fin(r => { B.garages = r.ok && r.j && Array.isArray(r.j.garages) ? r.j.garages : []; }));
    appel("loadouts", { action: "list" }).then(fin(r => { B.lo = r.ok && r.j && Array.isArray(r.j.loadouts) ? r.j.loadouts : []; }));
    appel("loadouts", { action: "prio_get" }).then(fin(r => { B.prio = r.ok && r.j ? r.j : { prio: [], owned: [] }; }));
    /* la référence des chars et des équipements est lourde : une fois suffit,
       et la vue Loadouts l'a peut-être déjà chargée */
    if (!LO_REF) appel("reference").then(fin(r => { if (r.ok && r.j && !LO_REF) LO_REF = r.j; }));
    fetch("mod-version.json", { cache: "no-store" }).then(r => r.json()).then(fin(j => { B.modv = j && j.version; })).catch(() => {});
  }

  /* Dans l'application : openApp a déjà chargé les batailles du clan
     avant de montrer quoi que ce soit. switchView("briefing") appelle
     ceci à chaque ouverture de la vue. */
  function ouvre() {
    B.clan = true;
    if (!B.ouvert) { B.ouvert = true; B.vu = visite(); squelette(); }
    chargeLeger();
  }
  /* Dans le labo : la page fait tout elle-même, batailles comprises. */
  function demarre() {
    document.documentElement.setAttribute("data-theme", "dark");
    if (!lsGet(LS_SESSION)) {
      HOTE.innerHTML = `<section class="vd bf-vd"><h1 class="vd-t">${tr("Connecte-toi")}</h1><p class="vd-p">${tr("Le briefing est ta page personnelle : il faut être connecté avec ton compte Wargaming.")} <a class="bf-lien" href="index.html">${tr("Se connecter →")}</a></p></section>`;
      return;
    }
    B.ouvert = true;
    B.vu = visite();
    squelette();
    chargeLeger();
    chargeClan();
  }

  if (!DANS_APPLI) demarre();
  else {
    window.bfOuvre = ouvre;
    /* openApp a pu montrer la vue avant que ce fichier soit lu */
    if (!HOTE.classList.contains("hidden")) ouvre();
  }
})();
