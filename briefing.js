/* Clan Plus — le Briefing, la page d'arrivée du joueur connecté.

   Une page sur TOI, pas sur le clan (retour de Robert, 21/10/2026) :
     · en haut, réduits : ce soir (ton poste, ou le bilan de la soirée,
       ou la prochaine activité) et ce qu'il te reste à faire ;
     · l'en-tête joueur : ta cote, tes batailles, tes marques, ton SR ;
     · au cœur, « Mes chars » : marques d'excellence, maîtrise, stats en
       aléatoire et en Bastion, équipement monté face au setup du clan.
       Un clic ouvre la fiche du char.

   D'où vient chaque chiffre :
     · API Wargaming, lue depuis le navigateur comme « Chercher un clan »
       (csWg) : account/info, tanks/stats (stats par char, maîtrise),
       tanks/achievements (marksOnGun), encyclopedia/vehicles (nom, rang,
       image ; gardée sept jours dans le navigateur) ;
     · le mod : le garage (chars possédés VI/VIII/X, équipement monté) ;
     · nos batailles (clan-data) : SR et stats de Bastion par char.
   Le % vers la prochaine marque n'existe que dans le jeu : il viendra
   avec une version du mod qui le lira en même temps que le garage.

   Chargé en différé APRÈS app.js : le SR, la lecture des line-ups et
   des loadouts sont ceux de l'application, pas des copies.

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

  const RANGS = [10, 8, 6], ROMAIN = { 6: "VI", 8: "VIII", 10: "X" };
  const CLASSE = { heavyTank: "Lourd", mediumTank: "Moyen", lightTank: "Léger", "AT-SPG": "Chasseur", SPG: "Artillerie" };
  const MAITRISE = { 4: "As", 3: "1re classe", 2: "2e classe", 1: "3e classe" };
  const TRIS = [["batailles", "Batailles"], ["marques", "Marques"], ["sr", "SR Bastion"], ["degats", "Dégâts"]];
  const PAR_PAGE = 12;

  /* L'état de la page. Chaque champ reste à null tant que sa requête
     n'est pas revenue : la partie qui en dépend garde son squelette. */
  const B = {
    vu: null, moment: null, officier: false,
    lu: null, ev: null, liens: null, garages: null, lo: null, prio: null, modv: null,
    clan: false, clanErr: false,
    wg: null, wgErr: false, wgEnCours: false, ency: {}, encyErr: {}, encyEnCours: {},
    /* les réglages de « Mes chars », gardés d'une visite à l'autre */
    rang: [10, 8, 6].includes(Number(lsGet("cp_bf_rang"))) ? Number(lsGet("cp_bf_rang")) : 10,
    tri: TRIS.some(x => x[0] === lsGet("cp_bf_tri")) ? lsGet("cp_bf_tri") : "batailles",
    tous: false, voirTout: false, fiche: null,
    dispoFaite: {}, dispoMsg: {}, dispoMinuteur: {},
  };

  const maintenant = () => Date.now() / 1000;
  const ic = id => `<svg class="ic" aria-hidden="true"><use href="#${id}"/></svg>`;
  const pct = (a, b) => b ? Math.round(a / b * 100) : null;

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
     pas comme une nouvelle visite. Sert au bilan « depuis ta visite ». */
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
     clan-data le dit, mais c'est la requête la plus lourde. Dans le labo,
     en attendant, le pseudo gardé à la connexion, retrouvé dans les
     line-ups. Dans l'application, ME_ID est déjà connu. */
  function moi() {
    if (ME_ID != null) return Number(ME_ID);
    const nick = String(lsGet("cp_nick") || "").toLowerCase();
    if (!nick) return null;
    for (const lu of B.lu || []) for (const s of lu.slots || [])
      if (s && s._type !== "meta" && String(s.name || "").toLowerCase() === nick) return Number(s.account_id);
    return null;
  }
  function monSlot(lu) { const me = moi(); return (lu.slots || []).find(s => s && s._type !== "meta" && Number(s.account_id) === me) || null; }
  function semaineCourante() { return luDateISO(luMonday()); }

  /* Ce qu'on sait d'un char : l'encyclopédie d'abord (nom, rang, image),
     puis la table des chars du clan, puis la référence des loadouts. */
  function infoChar(id) {
    id = Number(id);
    for (const r of RANGS) { const e = B.ency[r] && B.ency[r].get(id); if (e) return { nom: e.s || e.n, nomLong: e.n, rang: r, classe: e.c, prem: e.p, img: e.i }; }
    const v = VEHMAP[id];
    if (v) return { nom: v.name, nomLong: v.name, rang: Number(v.tier) || 0, classe: v.cls, prem: false, img: "" };
    const x = ((LO_REF && LO_REF.tanks) || []).find(y => Number(y.tank_id) === id);
    return x ? { nom: x.name, nomLong: x.name, rang: Number(x.tier) || 0, classe: x.type, prem: false, img: x.small_icon || "" } : null;
  }
  function nomChar(id) { const i = id ? infoChar(id) : null; return i ? i.nom : ""; }
  function imgChar(i) {
    const repli = "classes/" + encodeURIComponent(i.classe || "mediumTank") + ".png";
    return `<img src="${esc(i.img || repli)}" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${repli}'">`;
  }

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
  /* Le moment décide de ce que dit le bandeau du haut : ton poste avant
     l'activité, le bilan juste après, la prochaine activité sinon. */
  function leMoment() {
    const n = maintenant(), p = prochaine(), f = derniereFinie();
    if (p && p.event_ts - n < 14 * H) return "avant";          // avant ou pendant
    if (f && n - finDe(f) < 6 * H) return "apres";
    if (ceSoir() && new Date().getHours() >= 12) return "avant"; // compo épinglée, rien au calendrier
    return "semaine";
  }

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
    return (g.tanks || []).find(x => Number(x.id) === Number(id)) || false;
  }
  /* L'équipement d'un char : ce qui est monté, et le setup du clan.
     Équipements comparés PAR FAMILLE (un fouloir bonus vaut un fouloir),
     consommables par identifiant exact — comme la pastille du mod. */
  function equipementDe(tankId) {
    if (!LO_REF) return null;
    const lo = (B.lo || []).find(l => Number(l.tank_id) === Number(tankId)) || null;
    const F = loEqFam(), em = LO_REF.equipmentMap || {};
    const fam = id => F.idFam[id] || ("id" + id);
    const nomEq = id => (F.fam[F.idFam[id]] && F.fam[F.idFam[id]].name) || (em[id] && em[id].name) || ("#" + id);
    const nomCo = id => { const c = (LO_REF.consumables || []).find(x => Number(x.id) === Number(id)); return c ? c.name : "#" + id; };
    const monte = charAuGarage(tankId);
    const eqClan = lo ? (lo.equipment || []).map(Number) : [], coClan = lo ? (lo.consumables || []).map(Number) : [];
    /* ce qui est monté, marqué par rapport au clan s'il y a un setup */
    const eq = monte ? (monte.eq || []).map(Number).map(id => ({ nom: nomEq(id), ok: lo ? eqClan.some(c => fam(c) === fam(id)) : null })) : [];
    const cons = monte ? (monte.cons || []).map(Number).map(id => ({ nom: nomCo(id), ok: lo ? coClan.includes(id) : null })) : [];
    /* le setup du clan, marqué par rapport à ce qui est monté */
    const clan = lo ? eqClan.map(id => ({ nom: nomEq(id), ok: monte ? (monte.eq || []).some(m => fam(m) === fam(id)) : null }))
      .concat(coClan.map(id => ({ nom: nomCo(id), ok: monte ? (monte.cons || []).map(Number).includes(id) : null }))) : [];
    return { monte, eq, cons, clan, aSetup: !!lo, manque: clan.filter(p => p.ok === false).length };
  }

  /* ══ Ce qu'il reste à faire ════════════════════════════════════════ */
  function aFaire() {
    const items = [], sem = semaineCourante();
    for (const lu of B.lu || []) {
      const s = monSlot(lu);
      if (!s) continue;
      const av = luAvailability(s), aJour = luMeta(lu).week_start === sem;
      const fait = B.dispoFaite[lu.id];
      if (aJour && av.some(Boolean) && !fait) continue;
      items.push({
        cle: "dispo-" + lu.id, ic: "i-cal", fait: !!fait && av.some(Boolean),
        titre: tr("Coche tes soirs — %1", esc(lu.name)),
        texte: !aJour ? tr("La semaine de cette line-up n'est pas encore ouverte : un officier doit la lancer.") : "",
        jours: aJour ? { lu: lu.id, av } : null,
      });
    }
    if (B.liens) {
      const l = B.liens.links || [], gar = B.liens.garage;
      if (!l.length) items.push({ cle: "mod", ic: "i-link", titre: tr("Relie ton jeu"),
        texte: tr("Ton équipement et ton poste du soir s'afficheront ici et dans le jeu."), lien: ["lier", tr("Relier mon jeu")] });
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
        texte: manque.map(id => esc(nomChar(id) || "#" + id)).join(", "), lien: ["prio", tr("Liste du clan")] });
    }
    return items;
  }
  function cmpVersion(a, b) {
    const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
    return 0;
  }

  /* ══ Les batailles du joueur (nos données) ═════════════════════════ */
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
    return { n: lot.length, v, d, sr: srAvg(lot) };
  }
  function srMoyen30(mes) {
    const n = maintenant(), l = mes.filter(r => estTierSR(r) && n - r.ts <= 30 * J);
    return l.length >= 5 ? { sr: srAvg(l), trente: true } : { sr: srAvg(mes.filter(estTierSR)), trente: false };
  }
  /* Bastion par char, d'après les batailles enregistrées par le mod */
  function bastionParChar() {
    const par = new Map();
    for (const r of mesBatailles()) { const a = par.get(r.veh) || []; a.push(r); par.set(r.veh, a); }
    const out = new Map();
    for (const [id, rows] of par) out.set(Number(id), {
      n: rows.length, v: rows.filter(r => r.result === 1).length, d: rows.filter(r => r.result === 0).length,
      dmg: Math.round(rows.reduce((s, r) => s + r.dmg, 0) / rows.length), sr: srAvg(rows.filter(estTierSR)), rows });
    return out;
  }

  /* ══ Mes chars ═════════════════════════════════════════════════════
     La liste d'un rang : les chars joués (API Wargaming), ceux du garage
     (mod) et ceux de nos batailles. Avec le garage connu, on ne montre
     d'abord que les chars possédés. */
  function listeChars(rang) {
    const E = B.ency[rang];
    if (!E) return null;
    const g = monGarage(), auGarage = new Set(g ? (g.tanks || []).map(x => Number(x.id)) : []);
    const bas = B.clan ? bastionParChar() : new Map();
    const ids = new Set();
    if (B.wg) for (const [id, s] of B.wg.stats) if (E.has(id) && s.all && s.all.battles > 0) ids.add(id);
    for (const id of auGarage) if (E.has(id)) ids.add(id);
    for (const id of bas.keys()) if (E.has(id)) ids.add(id);
    const prio = new Set(((B.prio && B.prio.prio) || []).map(Number));
    const tn = ceSoir(), ceSoirId = tn && tn.poste && tn.poste.tank_id ? Number(tn.poste.tank_id) : null;
    let l = [...ids].map(id => {
      const s = B.wg && B.wg.stats.get(id), a = (s && s.all) || {}, sk = (s && s.stronghold_skirmish) || {}, df = (s && s.stronghold_defense) || {};
      const nb = (sk.battles || 0) + (df.battles || 0);
      return { id, info: infoChar(id), garage: g ? auGarage.has(id) : null,
        marques: (B.wg && B.wg.marques.get(id)) || 0, maitrise: (s && s.mark_of_mastery) || 0,
        ale: { n: a.battles || 0, wr: pct(a.wins || 0, a.battles || 0), dmg: a.battles ? Math.round(a.damage_dealt / a.battles) : null },
        bas: { n: nb, wr: pct((sk.wins || 0) + (df.wins || 0), nb) },
        cp: bas.get(id) || null, prio: prio.has(id), soir: id === ceSoirId };
    });
    const total = l.length;
    if (g && !B.tous) l = l.filter(c => c.garage);
    const cle = {
      batailles: c => c.ale.n,
      marques: c => c.marques * 1e6 + c.ale.n,
      sr: c => (c.cp && c.cp.sr != null ? c.cp.sr : -1) * 1e4 + c.bas.n,
      degats: c => c.ale.dmg || 0,
    }[B.tri];
    l.sort((x, y) => cle(y) - cle(x) || x.info.nom.localeCompare(y.info.nom));
    return { chars: l, total, filtre: !!g && !B.tous };
  }

  /* trois traits sur le canon, comme dans le jeu */
  function marquesHTML(n) {
    const l = n ? trn(n, "%1 marque d'excellence", "%1 marques d'excellence") : tr("Aucune marque d'excellence");
    return `<span class="bf-mq" role="img" aria-label="${esc(l)}" title="${esc(l)}">${[1, 2, 3].map(i => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}</span>`;
  }
  function maitriseHTML(m) {
    return m ? `<span class="bf-mt m${m}" title="${esc(tr("Badge de maîtrise"))}">${tr(MAITRISE[m])}</span>` : "";
  }
  function piecesHTML(l) {
    return `<ul class="bf-pieces">${l.map(x => `<li class="${x.ok === true ? "ok" : x.ok === false ? "ko" : ""}">${x.ok === true ? "✓ " : x.ok === false ? "✗ " : ""}${esc(x.nom)}</li>`).join("")}</ul>`;
  }
  function srHTML(sr) { const p = ceTier(sr); return `<b class="bf-srv" style="color:${p.c}" title="${esc(tr(p.l))}">${sr == null ? "—" : fmt(sr)}</b>`; }

  function carteChar(c) {
    const i = c.info, ouvert = B.fiche === c.id, eq = equipementDe(c.id);
    const chips = [maitriseHTML(c.maitrise), c.soir ? `<span class="bf-puce or">${tr("Ce soir")}</span>` : "",
      c.prio ? `<span class="bf-puce or">${tr("Prio clan")}</span>` : "",
      c.garage === false ? `<span class="bf-puce">${tr("Plus au garage")}</span>` : ""].join("");
    const ligneEq = !eq || !eq.monte ? "" : `<div class="bf-c-eq">${eq.eq.map(x =>
      `<span class="${x.ok === true ? "ok" : x.ok === false ? "ko" : ""}" title="${esc(x.ok === false ? tr("Pas dans le setup du clan") : x.ok ? tr("Comme le setup du clan") : "")}">${x.ok === false ? "✗ " : x.ok ? "✓ " : ""}${esc(x.nom)}</span>`).join("")}</div>`;
    return `<article class="bf-char${ouvert ? " ouvert" : ""}" data-char="${c.id}">
      <button type="button" class="bf-c-t" data-bf-char="${c.id}" aria-expanded="${ouvert}">
        <span class="bf-c-img">${imgChar(i)}</span>
        <span class="bf-c-n"><b>${esc(i.nom)}</b><i>${ROMAIN[i.rang] || i.rang} · ${esc(tr(CLASSE[i.classe] || i.classe || ""))}${i.prem ? " · " + tr("premium") : ""}</i></span>
        ${marquesHTML(c.marques)}
      </button>
      ${chips ? `<div class="bf-c-chips">${chips}</div>` : ""}
      <dl class="bf-c-s">
        <div><dt>${tr("Aléatoires")}</dt><dd>${c.ale.n ? tr("<b>%1</b> bat. · <b>%2</b> · <b>%3</b> dég.", fmt(c.ale.n), c.ale.wr + PC, fmt(c.ale.dmg)) : tr("pas joué")}</dd></div>
        <div><dt>${tr("Bastion")}</dt><dd>${c.bas.n ? tr("<b>%1</b> bat. · <b>%2</b>", fmt(c.bas.n), c.bas.wr + PC) : tr("pas joué")}${c.cp && c.cp.sr != null ? " · SR " + srHTML(c.cp.sr) : ""}</dd></div>
      </dl>
      ${ligneEq}
      ${ouvert ? ficheHTML(c, eq) : ""}
    </article>`;
  }
  /* La fiche, au clic : le détail des chiffres, l'équipement face au
     setup du clan, les dernières batailles de Bastion sur ce char. */
  function ficheHTML(c, eq) {
    const cp = c.cp;
    const lignes = (cp ? cp.rows : []).slice(0, 5).map(r => {
      const res = r.result === 1 ? ["v", tr("Victoire")] : r.result === 0 ? ["d", tr("Défaite")] : ["n", tr("Nul")];
      const sr = srBattle(r);
      return `<li><a class="bf-fb ${res[0]}" href="${esc(LIENS.bataille(r.battleId))}" data-bf-go="bataille" data-bf-id="${esc(String(r.battleId))}">
        <span><b>${esc(prettyMap(r.mapName))}</b><i>${jourDit(r.ts, true)}</i></span><span class="bf-fb-r">${res[1]}</span>
        <span>${tr("%1 dég.", fmt(r.dmg))}</span><span>SR ${srHTML(sr)}</span></a></li>`;
    }).join("");
    const eqBloc = !eq ? "" : !eq.monte
      ? `<p class="bf-disc">${tr(monGarage() === null ? "Relie ton jeu pour voir l'équipement monté sur ce char." : "Ce char n'est pas dans ton garage.")}</p>` +
        (eq.aSetup ? `<span class="bf-k">${tr("Setup du clan")}</span>${piecesHTML(eq.clan)}` : "")
      : `<span class="bf-k">${tr("Monté")}</span>${piecesHTML(eq.eq.concat(eq.cons))}` +
        (eq.aSetup ? `<span class="bf-k">${tr("Setup du clan")}</span>${piecesHTML(eq.clan)}${eq.manque ? `<p class="bf-disc">${trn(eq.manque, "%1 pièce du setup du clan manque.", "%1 pièces du setup du clan manquent.")}</p>` : `<p class="bf-disc ok">${tr("✓ Monté comme le veut le clan.")}</p>`}`
          : `<p class="bf-disc">${tr("Pas de setup du clan pour ce char.")}</p>`);
    return `<div class="bf-fiche">
      <div class="bf-f-col"><span class="bf-k">${tr("Tes chiffres")}</span><table class="bf-f-t">
        <tr><th>${tr("Aléatoires")}</th><td>${fmt(c.ale.n)}</td><td>${c.ale.wr == null ? "—" : c.ale.wr + PC}</td><td>${c.ale.dmg == null ? "—" : tr("%1 dég.", fmt(c.ale.dmg))}</td></tr>
        <tr><th>${tr("Bastion (Wargaming)")}</th><td>${fmt(c.bas.n)}</td><td>${c.bas.wr == null ? "—" : c.bas.wr + PC}</td><td>—</td></tr>
        <tr><th>${tr("Bastion (Clan Plus)")}</th><td>${cp ? fmt(cp.n) : "0"}</td><td>${cp ? pct(cp.v, cp.v + cp.d) + PC : "—"}</td><td>${cp ? tr("%1 dég.", fmt(cp.dmg)) : "—"}</td></tr>
      </table><p class="bf-disc">${tr("Colonnes : batailles, victoires, dégâts moyens. « Clan Plus » : les batailles enregistrées par le mod, avec ton SR.")}</p></div>
      <div class="bf-f-col">${eqBloc}</div>
      <div class="bf-f-col"><span class="bf-k">${tr("Tes dernières batailles de Bastion")}</span>${lignes ? `<ol class="bf-f-b">${lignes}</ol>` : `<p class="bf-disc">${tr("Aucune bataille de clan enregistrée sur ce char.")}</p>`}</div>
    </div>`;
  }

  function sectionChars() {
    const tete = `<header class="bf-s-h"><h2>${tr("Mes chars")}</h2>
      <div class="bf-seg" role="group" aria-label="${esc(tr("Rang"))}">${RANGS.map(r => `<button type="button" data-bf-rang="${r}" class="${r === B.rang ? "on" : ""}" aria-pressed="${r === B.rang}">${tr("Rang %1", ROMAIN[r])}</button>`).join("")}</div>
      <label class="bf-tri"><span>${tr("Trier par")}</span><select data-bf-tri>${TRIS.map(([k, l]) => `<option value="${k}"${k === B.tri ? " selected" : ""}>${tr(l)}</option>`).join("")}</select></label>
    </header>`;
    if (B.encyErr[B.rang]) return tete + `<div class="bf-err"><p>${tr("Wargaming ne répond pas : tes chars n'ont pas pu être chargés.")}</p><button type="button" class="bf-btn" data-bf="relance-wg">${tr("Réessayer")}</button></div>`;
    const L = listeChars(B.rang);
    if (!L || (!B.wg && !B.wgErr)) return tete + `<div class="bf-grille">${Array.from({ length: 6 }, () => `<div class="bf-char bf-char-sk">${SQUELETTE}</div>`).join("")}</div>`;
    const avis = monGarage() === null ? `<p class="bf-avis">${ic("i-link")} ${tr("Relie ton jeu pour voir l'équipement monté sur chaque char et le comparer au setup du clan.")} ${lienHTML("lier", tr("Relier mon jeu"))}</p>`
      : B.wgErr ? `<p class="bf-avis">${tr("Wargaming ne répond pas : les marques et les stats en aléatoire manquent pour l'instant.")}</p>` : "";
    if (!L.chars.length) return tete + avis + `<p class="bf-vide">${L.total ? tr("Aucun char de ce rang dans ton garage.") : tr("Aucun char de ce rang joué pour l'instant.")}</p>` +
      (L.total && L.filtre ? `<p><button type="button" class="bf-btn" data-bf="tous">${trn(L.total, "Voir le char joué", "Voir les %1 chars joués")}</button></p>` : "");
    const montres = B.voirTout ? L.chars : L.chars.slice(0, PAR_PAGE);
    const resume = L.filtre ? trn(L.chars.length, "%1 char au garage", "%1 chars au garage") : trn(L.chars.length, "%1 char joué", "%1 chars joués");
    const bascule = L.filtre && L.total > L.chars.length ? `<button type="button" class="bf-lienb" data-bf="tous">${tr("Montrer aussi les chars vendus")}</button>`
      : (!L.filtre && monGarage() ? `<button type="button" class="bf-lienb" data-bf="tous">${tr("Seulement mon garage")}</button>` : "");
    return tete + avis + `<p class="bf-resume">${resume}${bascule ? " · " + bascule : ""}</p>
      <div class="bf-grille">${montres.map(carteChar).join("")}</div>` +
      (L.chars.length > montres.length ? `<p class="bf-plus"><button type="button" class="bf-btn" data-bf="voir-tout">${trn(L.chars.length - montres.length, "Voir l'autre char", "Voir les %1 autres chars")}</button></p>` : "");
  }

  /* ══ L'en-tête joueur ══════════════════════════════════════════════ */
  function enTete() {
    const me = moi(), m = (MEMBERS || []).find(x => Number(x.account_id) === me);
    const nick = (B.wg && B.wg.info && B.wg.info.nickname) || (m && m.nickname) || lsGet("cp_nick") || "";
    const grade = m ? tr(ROLE_FR[normRole(m.wg_role)] || m.wg_role || "") : "";
    const clan = (CLANINFO && CLANINFO.tag) || CLANTAG;
    const st = B.wg && B.wg.info && B.wg.info.statistics && B.wg.info.statistics.all;
    const tuile = (l, v, s) => `<div><span>${l}</span><b>${v}</b>${s ? `<i>${s}</i>` : ""}</div>`;
    const charge = !B.wg && !B.wgErr ? `<span class="bf-sk-t"></span>` : "—";
    /* les marques : le total, et combien de chars à trois, deux, une */
    let marques = charge, detail = "";
    if (B.wg) {
      const n = [0, 0, 0, 0]; for (const v of B.wg.marques.values()) n[v]++;
      marques = String(n[1] + 2 * n[2] + 3 * n[3]);
      detail = [3, 2, 1].filter(k => n[k]).map(k => `${k}★ ×${n[k]}`).join(" · ") || tr("aucune pour l'instant");
    }
    let sr = B.clanErr ? "—" : charge, srDetail = "";
    if (B.clan) {
      const f = srMoyen30(mesBatailles());
      sr = f.sr == null ? "—" : `<span style="color:${ceTier(f.sr).c}">${fmt(f.sr)}</span>`;
      const sp = srByPlayer(), cl = [...sp.entries()].filter(([acc, v]) => v.etat !== "insuffisant" && MEMBERSET.has(acc)).sort((a, b) => b[1].sr - a[1].sr);
      const rang = cl.findIndex(([acc]) => acc === me);
      srDetail = rang >= 0 ? tr("%1 du clan · %2", rangDit(rang + 1), tr(f.trente ? "30 j" : "saison")) : tr(f.trente ? "30 derniers jours" : "toute la saison");
    }
    return `<div class="bf-j-id">
        <p class="bf-kick">${tr("Briefing")} · ${capFirst(new Date().toLocaleDateString(window.CP_LOC, { weekday: "long", day: "numeric", month: "long" }))}</p>
        <h1>${esc(nick)}</h1>
        <p class="bf-j-sub">${clan ? `<b>[${esc(clan)}]</b> ` : ""}${esc(grade)}</p>
      </div>
      <div class="bf-tuiles bf-j-t">
        ${tuile(tr("Cote Wargaming"), st ? fmt(B.wg.info.global_rating) : charge)}
        ${tuile(tr("Batailles"), st ? fmt(st.battles) : charge)}
        ${tuile(tr("Victoires"), st && st.battles ? (st.wins / st.battles * 100).toLocaleString(window.CP_LOC, { maximumFractionDigits: 1 }) + PC : charge)}
        ${tuile(tr("Dégâts moyens"), st && st.battles ? fmt(Math.round(st.damage_dealt / st.battles)) : charge)}
        ${tuile(tr("Marques d'excellence"), marques, detail)}
        ${tuile(tr("SR Bastion"), sr, srDetail)}
      </div>`;
  }

  /* ══ Le haut : ce soir, à faire ════════════════════════════════════ */
  function bandeauSoir() {
    if (!B.lu || !B.ev) return null;
    const n = maintenant();
    if (B.moment === "apres") {
      if (!B.clan) return null;
      const mes = mesBatailles(), neuf = B.vu ? mes.filter(r => r.ts > B.vu) : [], lot = neuf.length ? neuf : derniereSoiree(mes);
      const p = aVenir();
      if (!lot.length) return `<div class="bf-b-k">${ic("i-swords")}${tr("Soirée terminée")}</div>
        <p class="bf-b-t">${tr("Tu n'as pas joué de bataille de clan ce soir.")}</p>${p ? `<p class="bf-b-d">${tr("Prochaine activité : %1", jourDit(p.event_ts, true))}</p>` : ""}`;
      const b = bilan(lot);
      return `<div class="bf-b-k">${ic("i-swords")}${tr("Soirée terminée")}</div>
        <p class="bf-b-t">${tr("<b>%1 V · %2 D</b> · ton SR moyen %3", b.v, b.d, srHTML(b.sr))}</p>
        <p class="bf-b-d">${trn(b.n, "%1 bataille", "%1 batailles")}${p ? " · " + tr("prochaine activité %1", jourDit(p.event_ts, true)) : ""}</p>
        ${lienHTML("batailles", tr("Mes batailles"))}`;
    }
    if (B.moment === "avant") {
      const ev = prochaine(), tn = ceSoir();
      const quand = ev ? `${heure(ev.event_ts)} · <em>${ev.event_ts > n ? tr("dans %1", dans(ev.event_ts - n)) : tr("en cours")}</em>` : "";
      const k = `<div class="bf-b-k">${ic("i-target")}${tr("Ce soir")}${quand ? " · " + quand : ""}</div>`;
      if (tn && tn.poste) {
        const p = tn.poste, c = luCat(p.cat), tank = nomChar(p.tank_id);
        const g = p.tank_id ? charAuGarage(p.tank_id) : undefined, eq = p.tank_id ? equipementDe(p.tank_id) : null;
        const etat = [g === true || (g && typeof g === "object") ? `<span class="ok">${tr("✓ au garage")}</span>` : g === false ? `<span class="ko">${tr("✗ pas au garage")}</span>` : "",
          eq && eq.aSetup && eq.monte ? (eq.manque ? `<span class="ko">${trn(eq.manque, "✗ %1 pièce du setup manque", "✗ %1 pièces du setup manquent")}</span>` : `<span class="ok">${tr("✓ setup du clan")}</span>`) : ""].filter(Boolean).join(" · ");
        /* le char d'abord : c'est ce que le joueur doit sortir du garage */
        return k + `<div class="bf-b-l"><span class="bf-b-p"><b>${tn.i + 1}</b>/${tn.comp.posts.length}</span>
          <div><p class="bf-b-t">${luCatIco(c[0])}<b>${tank ? esc(tank) : tr("Char à ton choix")}</b></p>
          <p class="bf-b-d">${esc(tr(c[1]))} · ${ev ? esc(ev.title) + " · " : ""}${tr("compo « %1 »", esc(tn.comp.name))}</p>
          ${etat ? `<p class="bf-b-e">${etat}</p>` : ""}</div></div>
          ${p.tank_id ? `<button type="button" class="bf-lienb" data-bf-char="${Number(p.tank_id)}" data-bf-voir="1">${tr("Voir mon setup")} →</button> ` : ""}${lienHTML("lineups", tr("La line-up"))}`;
      }
      if (tn) return k + `<p class="bf-b-t">${tr("Tu es en réserve.")}</p><p class="bf-b-d">${tr("La composition « %1 » est publiée sans toi : reste joignable.", esc(tn.comp.name))}</p>${lienHTML("lineups", tr("La line-up"))}`;
      return k + `<p class="bf-b-t">${ev ? esc(ev.title) : ""}</p><p class="bf-b-d">${tr("La composition n'est pas encore publiée.")}</p>${dispoDuSoir(ev ? ev.event_ts : n)}`;
    }
    const p = aVenir();
    if (!p) return `<div class="bf-b-k">${ic("i-cal")}${tr("Prochaine activité")}</div><p class="bf-b-t">${tr("Rien au calendrier pour l'instant.")}</p>${lienHTML("calendrier", tr("Calendrier"))}`;
    return `<div class="bf-b-k">${ic("i-cal")}${tr("Prochaine activité")} · <em>${tr("dans %1", dans(p.event_ts - n))}</em></div>
      <p class="bf-b-t"><b>${esc(p.title)}</b></p><p class="bf-b-d">${capFirst(jourDit(p.event_ts, true))}</p>${dispoDuSoir(p.event_ts)}`;
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
  /* les initiales des jours, du lundi au dimanche, dans la langue du lecteur */
  const JOURS = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(window.CP_LOC, { weekday: "narrow" }).toUpperCase());
  function bandeauAFaire() {
    if (!B.lu) return null;
    const items = aFaire(), restants = items.filter(x => !x.fait).length, auj = luToday();
    const charge = !B.liens || !B.prio || B.garages === null;
    const tete = `<div class="bf-b-k">${ic("i-check")}${tr("À faire")}${restants ? ` <span class="bf-badge">${restants}</span>` : ""}${charge ? ` <em>${tr("vérification…")}</em>` : ""}</div>`;
    if (!items.length) return tete + `<p class="bf-b-t bf-pret">${ic("i-check")}${tr("Rien à faire : tu es prêt.")}</p>`;
    return tete + `<ul class="bf-todo">${items.map(x => `<li class="${x.fait ? "fait" : ""}">
        <span class="bf-tc">${ic(x.fait ? "i-check" : x.ic)}</span>
        <div class="bf-tt"><b>${x.titre}</b>${x.fait ? `<p>${tr("Enregistré. Tu pourras les changer dans Line-ups.")}</p>` : x.texte ? `<p>${x.texte}</p>` : ""}
          ${x.jours ? `<div class="bf-jours" role="group" aria-label="${esc(tr("Tes soirs de la semaine"))}">${x.jours.av.map((on, i) =>
            `<button type="button" class="bf-j${on ? " on" : ""}${i === auj ? " auj" : ""}" data-lu="${esc(String(x.jours.lu))}" data-j="${i}" aria-pressed="${on}" aria-label="${esc(capFirst(new Date(2024, 0, 1 + i).toLocaleDateString(window.CP_LOC, { weekday: "long" })))}"${i === auj ? ` title="${esc(tr("Ce soir"))}"` : ""}>${JOURS[i]}</button>`).join("")}
            ${B.dispoMsg[x.jours.lu] ? `<span class="bf-msg">${B.dispoMsg[x.jours.lu]}</span>` : ""}</div>` : ""}
        </div>${x.lien && !x.fait ? lienHTML(x.lien[0], x.lien[1]) : ""}</li>`).join("")}</ul>`;
  }

  /* ══ Le rendu ══════════════════════════════════════════════════════ */
  /* Un lien porte sa cible deux fois : une adresse, pour le labo et le
     clic du milieu, et une clé que l'application traduit en changement
     de vue (voir ALLER). */
  function lienHTML(cle, texte) {
    return `<a class="bf-lien" href="${esc(LIENS[cle])}" data-bf-go="${cle}">${texte}<span aria-hidden="true"> →</span></a>`;
  }
  const SQUELETTE = `<div class="bf-sk" aria-hidden="true"><i></i><i></i><i></i></div>`;
  function squelette() {
    HOTE.innerHTML = `<div class="bf-haut">
        <section class="bf-bloc-h bf-soir" id="bfSoir" aria-busy="true">${SQUELETTE}</section>
        <section class="bf-bloc-h bf-afaire" id="bfAFaire" aria-busy="true">${SQUELETTE}</section>
      </div>
      <section class="bf-joueur" id="bfJoueur" aria-busy="true">${SQUELETTE}</section>
      <section class="bf-chars" id="bfChars" aria-label="${esc(tr("Mes chars"))}">${SQUELETTE}</section>`;
  }
  function remplit(id, html) {
    const el = document.getElementById(id);
    if (!el || html == null) return;
    el.innerHTML = html;
    el.removeAttribute("aria-busy");
  }
  function rafraichir() {
    if (!document.getElementById("bfChars")) return;
    const soir = document.getElementById("bfSoir");
    if (soir) soir.classList.toggle("bf-lumiere", B.moment === "avant");
    remplit("bfSoir", bandeauSoir());
    remplit("bfAFaire", bandeauAFaire());
    remplit("bfJoueur", enTete());
    if (!B.ency[B.rang]) chargeEncy(B.rang);
    remplit("bfChars", sectionChars());
  }

  /* ══ Les gestes ════════════════════════════════════════════════════ */
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
  /* ouvre (ou ferme) la fiche d'un char ; depuis le bandeau du soir, on
     bascule d'abord sur son rang et on descend jusqu'à elle */
  function basculeFiche(id, depuisHaut) {
    const i = infoChar(id);
    if (depuisHaut) {
      if (i && i.rang && i.rang !== B.rang) { B.rang = i.rang; lsSet("cp_bf_rang", String(i.rang)); }
      B.fiche = id; B.voirTout = true;
      if (charAuGarage(id) === false) B.tous = true;   // vendu : il faut montrer aussi les chars vendus
    } else B.fiche = B.fiche === id ? null : id;
    rafraichir();
    const el = HOTE.querySelector(`.bf-char[data-char="${id}"]`);
    if (el && depuisHaut) el.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  HOTE.addEventListener("click", e => {
    const r = e.target.closest("[data-bf]");
    if (r) {
      const a = r.dataset.bf;
      if (a === "relance") { chargeClan(); return; }
      if (a === "relance-wg") { B.wgErr = false; B.encyErr = {}; chargeWg(); rafraichir(); return; }
      if (a === "tous") { B.tous = !B.tous; B.voirTout = false; rafraichir(); return; }
      if (a === "voir-tout") { B.voirTout = true; rafraichir(); return; }
    }
    const rg = e.target.closest("[data-bf-rang]");
    if (rg) { B.rang = Number(rg.dataset.bfRang); B.fiche = null; B.voirTout = false; lsSet("cp_bf_rang", String(B.rang)); rafraichir(); return; }
    const ch = e.target.closest("[data-bf-char]");
    if (ch) { basculeFiche(Number(ch.dataset.bfChar), !!ch.dataset.bfVoir); return; }
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
    /* les soirs cochés depuis le briefing : l'action « attendance » existe
       déjà, un membre ne modifie que SA ligne. Envoi 0,6 s après le
       dernier clic, pour grouper les clics. */
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
      const rep = await appel("lineups", { action: "attendance", id: lu.id, availability: av });
      B.dispoMsg[lu.id] = tr(rep.ok ? "✓ Enregistré" : "Échec de l'envoi — réessaie");
      rafraichir();
    }, 600);
  });
  HOTE.addEventListener("change", e => {
    const s = e.target.closest("[data-bf-tri]");
    if (!s) return;
    B.tri = s.value; lsSet("cp_bf_tri", B.tri); rafraichir();
  });

  /* ══ Le chargement ═════════════════════════════════════════════════ */
  /* Ce que Wargaming sait du joueur : son compte, ses chars, ses marques. */
  async function chargeWg() {
    const me = moi();
    if (me == null || B.wg || B.wgEnCours) return;
    B.wgEnCours = true;
    try {
      const [inf, st, ac] = await Promise.all([
        csWg("/wot/account/info/", { account_id: me, fields: "nickname,global_rating,statistics.all.battles,statistics.all.wins,statistics.all.damage_dealt" }),
        csWg("/wot/tanks/stats/", { account_id: me, fields: "tank_id,mark_of_mastery,all.battles,all.wins,all.damage_dealt,stronghold_skirmish.battles,stronghold_skirmish.wins,stronghold_defense.battles,stronghold_defense.wins" }),
        csWg("/wot/tanks/achievements/", { account_id: me, fields: "tank_id,achievements" }),
      ]);
      const stats = new Map(), marques = new Map();
      for (const s of (st.data && st.data[me]) || []) stats.set(Number(s.tank_id), s);
      for (const x of (ac.data && ac.data[me]) || []) { const m = x.achievements && x.achievements.marksOnGun; if (m) marques.set(Number(x.tank_id), Number(m)); }
      B.wg = { info: (inf.data && inf.data[me]) || null, stats, marques };
    } catch (_) { B.wgErr = true; }
    B.wgEnCours = false;
    rafraichir();
  }
  /* L'encyclopédie d'un rang (nom, classe, image) : quelques centaines
     de chars qui ne changent qu'à une mise à jour du jeu. Gardée sept
     jours dans le navigateur. */
  async function chargeEncy(rang) {
    if (B.ency[rang] || B.encyEnCours[rang] || B.encyErr[rang]) return;
    const cle = "cp_bf_ency_" + rang;
    try {
      const c = JSON.parse(localStorage.getItem(cle) || "null");
      if (c && Date.now() - c.t < 7 * J * 1000 && Array.isArray(c.d)) { B.ency[rang] = new Map(c.d.map(x => [x.id, x])); rafraichir(); return; }
    } catch (_) { /* cache illisible : on recharge */ }
    B.encyEnCours[rang] = true;
    try {
      const d = [];
      for (let page = 1; page <= 6; page++) {
        /* big_icon (160×100) plutôt que small_icon : la petite silhouette
           se perd dans la carte du char */
        const j = await csWg("/wot/encyclopedia/vehicles/", { tier: rang, limit: 100, page_no: page, fields: "tank_id,name,short_name,type,nation,is_premium,images.big_icon,images.small_icon" });
        for (const v of Object.values(j.data || {})) if (v) d.push({ id: Number(v.tank_id), n: v.name, s: v.short_name, c: v.type, p: !!v.is_premium,
          i: String((v.images && (v.images.big_icon || v.images.small_icon)) || "").replace(/^http:/, "https:") });
        if (!j.meta || !j.meta.page_total || page >= j.meta.page_total) break;
      }
      B.ency[rang] = new Map(d.map(x => [x.id, x]));
      try { localStorage.setItem(cle, JSON.stringify({ t: Date.now(), d })); } catch (_) { /* plein : tant pis */ }
    } catch (_) { B.encyErr[rang] = true; }
    B.encyEnCours[rang] = false;
    rafraichir();
  }
  async function chargeClan() {
    B.clanErr = false;
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
    chargeWg();
    rafraichir();
  }
  /* Les données légères : relues à chaque ouverture de la vue — un soir
     coché dans Line-ups, une compo épinglée entre-temps doivent se voir. */
  function chargeLeger() {
    const fin = f => r => { f(r); rafraichir(); };
    Promise.all([appel("lineups", { action: "list" }), appel("clan-events", { action: "list" })]).then(([l, e]) => {
      B.lu = l.ok && l.j && Array.isArray(l.j.lineups) ? l.j.lineups : [];
      B.ev = e.ok && e.j && Array.isArray(e.j.events) ? e.j.events : [];
      B.officier = !!(l.ok && l.j && l.j.canEdit);
      B.moment = leMoment();
      chargeWg();   // le compte est peut-être connu maintenant (labo)
      rafraichir();
    });
    appel("mod", { action: "links" }).then(fin(r => { B.liens = r.ok && r.j ? r.j : { links: [], garage: null }; }));
    appel("mod", { action: "garages" }).then(fin(r => { B.garages = r.ok && r.j && Array.isArray(r.j.garages) ? r.j.garages : []; }));
    appel("loadouts", { action: "list" }).then(fin(r => { B.lo = r.ok && r.j && Array.isArray(r.j.loadouts) ? r.j.loadouts : []; }));
    appel("loadouts", { action: "prio_get" }).then(fin(r => { B.prio = r.ok && r.j ? r.j : { prio: [], owned: [] }; }));
    /* la référence des équipements est lourde : une fois suffit, et la vue
       Loadouts l'a peut-être déjà chargée */
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
    chargeWg();
  }
  /* Dans le labo : la page fait tout elle-même, batailles comprises. */
  function demarre() {
    document.documentElement.setAttribute("data-theme", "dark");
    if (!lsGet(LS_SESSION)) {
      HOTE.innerHTML = `<section class="bf-joueur"><div class="bf-j-id"><h1>${tr("Connecte-toi")}</h1><p class="bf-j-sub">${tr("Le briefing est ta page personnelle : il faut être connecté avec ton compte Wargaming.")} <a class="bf-lien" href="index.html">${tr("Se connecter →")}</a></p></div></section>`;
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
