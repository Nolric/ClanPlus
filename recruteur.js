/* ═══════════════════════════════════════════════════════════════════
   ESPACE RECRUTEUR — module partagé (20/10/2026)
   Un seul module, deux portes (décision de Robert) : l'onglet « Espace
   recruteur » de l'appli, et le bouton du même nom sur la page publique
   « Trouver un clan ». Deux copies du formulaire auraient divergé au
   premier changement.

   L'espace accueille plusieurs outils. 1) Les ANNONCES DE RECRUTEMENT : 3 au plus par clan, chacune en ligne ou en
   pause, et une annonce non mise à jour depuis 30 jours sort de la page
   publique jusqu'à ce qu'on la remette en ligne (fonction clan-offers).
   2) Les SORTIES DE CLAN en direct : les joueurs qui quittent un clan actif
   en Bastion, filtrés selon les critères du clan (fonction clan-departures).

   Accès : commandant, officier exécutif, officier du personnel et
   recruteurs. C'est le SERVEUR qui l'impose (403 sinon) ; le module
   affiche simplement la porte fermée quand il reçoit ce refus.

   Écrit en français ; l'anglais vient de i18n/recruteur.en.js (chargé
   par les deux pages avant i18n.js). Le style vit dans app.css
   (#clanRecruit), que les deux pages chargent.

   Utilisation : CPRecruteur.mount(élément, ctx), avec
     ctx.call(nom, corps)  → la fonction serveur de la page ({ok,status,j})
     ctx.session           → le jeton de session Clan Plus
     ctx.clan              → { id, tag, name, em, m } si la page le connaît
     ctx.ratings           → les cotes Wargaming du clan, si connues
     ctx.loadClan(id)      → (facultatif) complète emblème, membres, cotes
     ctx.onSignedOut()     → (facultatif) la session a expiré
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const T = (s) => (window.t ? window.t(s) : s);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf = (v) => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString(window.CP_LOC || "fr-FR") : "—"; };
  const jour = (iso, opt) => new Date(iso).toLocaleDateString(window.CP_LOC || "fr-FR", opt || { day: "numeric", month: "long" });
  const sk = (w) => `<span class="rc-sk" style="width:${w}"></span>`;

  const LANGS = [["fr", "Français"], ["en", "Anglais"], ["de", "Allemand"], ["es", "Espagnol"], ["it", "Italien"], ["pl", "Polonais"],
    ["pt", "Portugais"], ["nl", "Néerlandais"], ["tr", "Turc"], ["cs", "Tchèque"], ["ru", "Russe"]];
  const ACTS = [["skirmish", "Escarmouches"], ["cw", "Clan Wars"], ["random", "Batailles aléatoires"], ["tournament", "Tournois"], ["fun", "Détente"]];
  const TIERS = [["", "Aucune"], ["5", "Rang 5+"], ["6", "Rang 6+"], ["7", "Rang 7+"], ["8", "Rang 8+"], ["9", "Rang 9+"], ["10", "Rang 10"]];
  const VIDE = { title: "", pitch: "", langs: [], activities: [], play_hours: "", min_wn8: null, min_battles: null, min_tier: null, contact: "", status: "paused" };
  const lib = (arr, v) => (arr.find((x) => x[0] === v) || [v, v])[1];
  const joursRestants = (o) => Math.max(0, Math.ceil((new Date(o.expires_at).getTime() - Date.now()) / 86400e3));
  const etat = (o) => (o.status !== "active" ? "pause" : o.expired ? "expiree" : "ligne");

  function mount(host, ctx) {
    // remonté sur le même élément (session expirée puis reconnexion) : l'ancien s'arrête
    if (host._rcStop) host._rcStop();
    const fin = new AbortController();
    host._rcStop = () => { fin.abort(); clearInterval(SO.timer); };
    const S = { offers: [], max: 3, life: 30, clan: ctx.clan || null, ratings: ctx.ratings || null,
      tool: "annonces", mode: "liste", edit: null, saved: null, msg: null, busy: false };

    /* ── la coquille : le titre, puis un onglet par outil ── */
    function shell(corps, nb) {
      if (nb != null) S.nb = nb;
      return `<h2 class="sec-h">${T("Espace recruteur")}</h2>
        <p class="sec-desc">${T("Les outils de recrutement de ton clan : tes annonces sur « Trouver un clan », et les joueurs qui viennent de quitter un clan actif en Bastion.")}</p>
        <nav class="rc-tabs" role="tablist" aria-label="${esc(T("Outils du recruteur"))}">
          <button type="button" role="tab" aria-selected="${S.tool === "annonces"}" data-tool="annonces"><span>${T("Annonces de recrutement")}</span>${S.nb != null ? `<span class="n">${S.nb} / ${S.max}</span>` : ""}</button>
          <button type="button" role="tab" aria-selected="${S.tool === "sorties"}" data-tool="sorties"><span class="rc-dot" aria-hidden="true"></span><span>${T("Sorties de clan")}</span><span class="n neuf"${SO.neufs.size ? "" : " hidden"}>+${SO.neufs.size}</span></button>
        </nav>
        <div class="rc-body">${corps}</div>`;
    }
    const msgbox = (titre, txt, bouton) => `<div class="rc-msgbox"><p><b>${titre}</b></p>${txt ? `<p class="s">${txt}</p>` : ""}${bouton || ""}</div>`;

    async function charger() {
      host.innerHTML = shell(`<section class="vd"><div class="vd-haut"><div class="vd-g"><p class="vd-t">${sk("55%")}</p><p class="vd-p">${sk("80%")}</p></div></div></section>
        <div class="rc-items">${sk("100%")}${sk("100%")}</div>`);
      const r = await ctx.call("clan-offers", { session: ctx.session, action: "mine" });
      if (r.status === 401) { if (ctx.onSignedOut) ctx.onSignedOut(); else host.innerHTML = shell(msgbox(T("Ta session a expiré."), T("Reconnecte-toi avec ton compte Wargaming."))); return; }
      if (r.status === 403 && r.j && r.j.error === "no_clan") { host.innerHTML = shell(msgbox(T("Tu n'as pas de clan."), T("L'Espace recruteur sert à publier les annonces d'un clan. Rejoins-en un d'abord."))); return; }
      if (r.status === 403) { host.innerHTML = shell(msgbox(T("Réservé à l'état-major du clan."), T("L'Espace recruteur est ouvert au commandant, à l'officier exécutif, à l'officier du personnel et aux recruteurs."))); return; }
      if (!r.ok) {
        host.innerHTML = shell(msgbox(T("L'Espace recruteur n'a pas pu être chargé."), esc((r.j && r.j.error) || String(r.status)), `<button type="button" class="btn" data-rc="reload">${T("Réessayer")}</button>`));
        return;
      }
      S.offers = Array.isArray(r.j.offers) ? r.j.offers : (r.j.offer ? [r.j.offer] : []);
      S.max = r.j.max || 3; S.life = r.j.lifetime_days || 30;
      if (!S.clan && r.j.clan) S.clan = { id: r.j.clan.clan_id, tag: r.j.clan.tag || "", name: r.j.clan.name || "" };
      S.nb = S.offers.length;
      if (S.tool === "sorties") sortiesOuvrir(); else liste();
      // l'emblème, les membres et les cotes, quand la page sait les chercher
      if (ctx.loadClan && S.clan && S.clan.id && (S.clan.em == null || !S.ratings)) {
        try { const x = await ctx.loadClan(S.clan.id); Object.assign(S.clan, { em: x.em, m: x.m }); S.ratings = x.ratings || S.ratings;
          if (S.tool === "annonces") { if (S.mode === "liste") liste(); else apercu(); } } catch (e) { /* l'aperçu s'en passe */ }
      }
    }

    /* ── Les annonces : la liste ── */
    function verdict() {
      const n = S.offers.filter((o) => etat(o) === "ligne").length, tot = S.offers.length, c = S.clan || {};
      const free = c.m != null ? Math.max(0, 100 - c.m) : null;
      let titre, ph = [];
      if (!tot) { titre = T("Ton clan <em>n'a pas encore d'annonce</em>."); ph.push(T("Sur « Trouver un clan », les annonces Clan Plus passent avant tous les autres clans.")); }
      else if (!n) { titre = T("Aucune annonce <em>en ligne</em>."); ph.push(T("Tes annonces sont enregistrées, mais aucun joueur ne les voit. Remets en ligne celle qui correspond à ton recrutement.")); }
      else { titre = n > 1 ? T("Ton clan a <em>{n} annonces en ligne</em>.").replace("{n}", n) : T("Ton clan a <em>1 annonce en ligne</em>.");
        ph.push(T("Elles apparaissent en tête de « Trouver un clan », pour tous les joueurs sans clan.")); }
      if (tot) ph.push(T("Une annonce non mise à jour pendant {n} jours sort de la page publique : il suffit de la remettre en ligne.").replace("{n}", S.life));
      return `<section class="vd rc-vd"><div class="vd-haut"><div class="vd-g"><h3 class="vd-t">${titre}</h3>
          <p class="vd-p">${ph.map((x) => `<span>${x}</span>`).join(" ")}</p>
          ${c.id ? `<a class="btn rc-pub" href="trouver-clan.html#clan-${c.id}" target="_blank" rel="noopener">${T("Voir la fiche publique du clan ↗")}</a>` : ""}</div>
        ${free != null ? `<div class="vd-n"><b>${nf(free)}</b><i>${free > 1 ? T("places libres") : T("place libre")}</i></div>` : ""}</div></section>`;
    }
    function itemHTML(o) {
      const e = etat(o), j = joursRestants(o);
      const pill = e === "ligne" ? `<span class="rc-pill on">${j > 1 ? T("En ligne · encore {n} jours").replace("{n}", j) : T("En ligne · dernier jour")}</span>`
        : e === "expiree" ? `<span class="rc-pill exp">${T("Expirée")}</span>` : `<span class="rc-pill">${T("En pause")}</span>`;
      const tags = [...(o.langs || []).map((l) => `<span class="rc-ptag">${esc(T(lib(LANGS, l)))}</span>`),
        ...(o.activities || []).map((a) => `<span class="rc-ptag act">${esc(T(lib(ACTS, a)))}</span>`)].join("");
      const quand = o.updated_at ? (o.updated_by_name ? T("Modifiée le {s} par {s}").replace("{s}", esc(jour(o.updated_at))).replace("{s}", esc(o.updated_by_name)) : T("Modifiée le {s}").replace("{s}", esc(jour(o.updated_at)))) : "";
      return `<article class="rc-item ${e}">
        <div class="rc-item-h">${pill}<small>${quand}</small></div>
        <h4 class="rc-item-t" data-i18n-skip>${esc(o.title || T("Annonce sans titre"))}</h4>
        ${o.pitch ? `<p class="rc-item-p" data-i18n-skip>${esc(o.pitch)}</p>` : ""}
        ${tags ? `<div class="rc-ptags">${tags}</div>` : ""}
        ${e === "expiree" ? `<p class="rc-item-w">${T("Elle n'apparaît plus sur « Trouver un clan » depuis le {s}.").replace("{s}", esc(jour(o.expires_at)))}</p>` : ""}
        <div class="rc-item-a">
          <button type="button" class="btn" data-rc="edit" data-id="${o.id}">${T("Modifier")}</button>
          ${e === "ligne" ? `<button type="button" class="btn" data-rc="pause" data-id="${o.id}">${T("Mettre en pause")}</button>`
            : `<button type="button" class="rc-go" data-rc="relance" data-id="${o.id}">${T("Remettre en ligne")}</button>`}
          <button type="button" class="rc-del" data-rc="del" data-id="${o.id}">${T("Supprimer")}</button>
        </div></article>`;
    }
    function liste() {
      S.mode = "liste"; S.edit = null;
      const plein = S.offers.length >= S.max;
      const bandeau = S.msg ? `<p class="rc-note ${S.msg[0]}" role="status">${S.msg[1]}</p>` : "";
      host.innerHTML = shell(verdict() + bandeau + `<div class="rc-items">${S.offers.map(itemHTML).join("")}
        <button type="button" class="rc-new" data-rc="new"${plein ? " disabled" : ""}>
          <span class="plus" aria-hidden="true">+</span><span><b>${T("Nouvelle annonce")}</b>
          <small>${plein ? T("{n} annonces au plus par clan : supprime-en une pour en créer une autre.").replace("{n}", S.max)
            : T("Une annonce par équipe ou par besoin : Bastion rang X, académie, Clan Wars…")}</small></span></button></div>`, S.offers.length);
      S.msg = null;
    }

    /* ── Les annonces : l'éditeur ── */
    function apercuHTML() {
      const o = S.edit || VIDE, c = S.clan || { tag: "", m: null }, rt = S.ratings;
      const langs = (o.langs || []).map((l) => `<span class="rc-ptag">${esc(T(lib(LANGS, l)))}</span>`).join("");
      const acts = (o.activities || []).map((a) => `<span class="rc-ptag act">${esc(T(lib(ACTS, a)))}</span>`).join("");
      const reqs = [];
      if (o.min_wn8) reqs.push(T("WN8 <b>{n}+</b>").replace("{n}", nf(o.min_wn8)));
      if (o.min_battles) reqs.push(T("<b>{n}</b> batailles minimum").replace("{n}", nf(o.min_battles)));
      if (o.min_tier) reqs.push(T("Chars <b>rang {n}+</b>").replace("{n}", o.min_tier));
      if (o.play_hours) reqs.push(`<span data-i18n-skip>${esc(o.play_hours)}</span>`);
      const contact = String(o.contact || "").trim(), isUrl = /^https?:\/\//i.test(contact) || /discord\.(gg|com)/i.test(contact);
      if (contact && !isUrl) reqs.push(T("Contact : <b>{s}</b>").replace("{s}", esc(contact)));
      const tier = rt ? [["fb_elo_rating_10", "Rang X"], ["fb_elo_rating_8", "Rang VIII"], ["fb_elo_rating_6", "Rang VI"]].find(([f]) => rt[f] && rt[f].rank != null) : null;
      const sous = [c.m != null ? T("{n} / 100 membres").replace("{n}", nf(c.m)) : "", tier ? `${T(tier[1])} #${nf(rt[tier[0]].rank)}` : ""].filter(Boolean).join(" · ");
      return `<article class="rc-prev">
        <div>
          ${langs ? `<div class="rc-ptags">${langs}</div>` : ""}
          <h4 class="rc-pt" data-i18n-skip>${esc(o.title || `[${c.tag || ""}]`)}</h4>
          ${o.pitch ? `<p class="rc-pp" data-i18n-skip>${esc(o.pitch)}</p>` : `<p class="rc-pp vide">${T("La présentation de ton clan apparaîtra ici.")}</p>`}
          ${acts ? `<div class="rc-ptags">${acts}</div>` : ""}
          ${reqs.length ? `<div class="rc-preqs">${reqs.map((x) => `<span>${x}</span>`).join("")}</div>` : ""}
        </div>
        <div class="rc-pside">
          <div class="rc-pclan">${c.em ? `<img src="${esc(c.em)}" alt="">` : `<span class="ph">${esc(String(c.tag || "").slice(0, 3))}</span>`}
            <span><b data-i18n-skip>[${esc(c.tag || "")}]</b><small>${sous}</small></span></div>
          <span class="rc-pgo">${contact && isUrl ? T("Contacter ↗") : T("Postuler ↗")}</span>
          <span class="rc-pbtn">${T("Voir le clan")}</span>
        </div></article>`;
    }
    function apercu() { const p = host.querySelector("#rcPreview"); if (p) p.innerHTML = apercuHTML(); }
    function editer(o) {
      S.mode = "edit";
      S.saved = o || null;
      S.edit = Object.assign({}, VIDE, o || {});
      const e = S.edit, neuve = !o, live = o && etat(o) === "ligne";
      const chips = (arr, sel, key) => arr.map(([v, l]) => `<button type="button" class="rc-chip" data-${key}="${v}" aria-pressed="${(sel || []).includes(v)}">${esc(T(l))}</button>`).join("");
      host.innerHTML = shell(`
        <button type="button" class="rc-back" data-rc="list"><span aria-hidden="true">‹</span> ${T("Toutes les annonces")}</button>
        <div class="rc-two">
          <form class="rc-card rc-form" autocomplete="off" novalidate>
            <fieldset>
              <h3 class="rc-st">${neuve ? T("Nouvelle annonce") : T("L'essentiel")}</h3>
              <label class="rc-f"><span>${T("Titre de l'annonce")} <small data-n="title">${(e.title || "").length} / 90</small></span>
                <input type="text" name="title" maxlength="90" placeholder="${esc(T("Ex : clan francophone détendu recrute pour le Bastion rang X"))}" value="${esc(e.title || "")}"></label>
              <label class="rc-f"><span>${T("Présentation du clan")} <small data-n="pitch">${(e.pitch || "").length} / 1500</small></span>
                <textarea name="pitch" maxlength="1500" rows="7" placeholder="${esc(T("L'ambiance, ce que vous jouez, quand, ce que vous attendez d'une recrue…"))}">${esc(e.pitch || "")}</textarea></label>
              <h3 class="rc-st">${T("Pour qui")}</h3>
              <div class="rc-f"><span>${T("Langues parlées")} <small>${T("4 au plus")}</small></span><div class="rc-chips" data-group="langs">${chips(LANGS, e.langs, "lang")}</div></div>
              <div class="rc-f"><span>${T("Vous jouez surtout")}</span><div class="rc-chips" data-group="activities">${chips(ACTS, e.activities, "act")}</div></div>
              <h3 class="rc-st">${T("Exigences")} <small>${T("facultatives")}</small></h3>
              <div class="rc-grid">
                <label class="rc-f"><span>${T("WN8 minimum")}</span><input type="number" name="min_wn8" min="0" max="99999" inputmode="numeric" placeholder="${esc(T("Ex : 1500"))}" value="${e.min_wn8 || ""}"></label>
                <label class="rc-f"><span>${T("Batailles minimum")}</span><input type="number" name="min_battles" min="0" inputmode="numeric" placeholder="${esc(T("Ex : 10000"))}" value="${e.min_battles || ""}"></label>
                <label class="rc-f"><span>${T("Rang de chars")}</span><select name="min_tier">${TIERS.map(([v, l]) => `<option value="${v}"${String(e.min_tier || "") === v ? " selected" : ""}>${esc(T(l))}</option>`).join("")}</select></label>
              </div>
              <label class="rc-f"><span>${T("Créneaux de jeu")}</span><input type="text" name="play_hours" maxlength="80" placeholder="${esc(T("Ex : du lundi au jeudi, 20 h – 23 h"))}" value="${esc(e.play_hours || "")}"></label>
              <h3 class="rc-st">${T("Contact")}</h3>
              <label class="rc-f"><span>${T("Lien Discord ou pseudo")}</span>
                <input type="text" name="contact" maxlength="200" placeholder="${esc(T("https://discord.gg/… ou un pseudo en jeu"))}" value="${esc(e.contact || "")}"></label>
              <p class="rc-help">${T("Un lien devient le bouton « Contacter » de l'annonce. Sinon, le bouton « Postuler » mène à la page Wargaming du clan.")}</p>
            </fieldset>
            <div class="rc-bar">
              <span class="rc-state" role="status" aria-live="polite"></span>
              ${neuve ? "" : `<button type="button" class="rc-del" data-rc="del" data-id="${o.id}">${T("Supprimer")}</button>`}
              <button type="button" class="btn" data-rc="${live ? "save-pause" : "save-draft"}">${live ? T("Mettre en pause") : T("Enregistrer sans publier")}</button>
              <button type="button" class="rc-go" data-rc="save-live">${live ? T("Enregistrer les modifications") : T("Publier l'annonce")}</button>
            </div>
          </form>
          <aside class="rc-side">
            <p class="rc-side-l">${T("Aperçu sur « Trouver un clan »")}</p>
            <div id="rcPreview">${apercuHTML()}</div>
            <p class="rc-help">${T("Les joueurs voient cette carte en tête de la page, avant les autres clans. Elle n'apparaît que lorsque l'annonce est publiée.")}</p>
          </aside>
        </div>`, S.offers.length);
      const f = host.querySelector(".rc-form");
      f.addEventListener("input", lire); f.addEventListener("change", lire);
      etatLigne();
    }
    function lire() {
      const f = host.querySelector(".rc-form"); if (!f) return;
      const v = (n) => f.elements[n].value, num = (n) => { const x = parseInt(v(n), 10); return Number.isFinite(x) && x > 0 ? x : null; };
      Object.assign(S.edit, { title: v("title").trim(), pitch: v("pitch").trim(), play_hours: v("play_hours").trim(), contact: v("contact").trim(),
        min_wn8: num("min_wn8"), min_battles: num("min_battles"), min_tier: num("min_tier"),
        langs: [...f.querySelectorAll('[data-group="langs"] .rc-chip[aria-pressed="true"]')].map((b) => b.dataset.lang),
        activities: [...f.querySelectorAll('[data-group="activities"] .rc-chip[aria-pressed="true"]')].map((b) => b.dataset.act) });
      f.querySelector('[data-n="title"]').textContent = `${v("title").length} / 90`;
      f.querySelector('[data-n="pitch"]').textContent = `${v("pitch").length} / 1500`;
      apercu();
      if (S.msg && S.msg[0] !== "busy") S.msg = null;
      etatLigne();
    }
    function modifie() {
      const a = S.edit, b = Object.assign({}, VIDE, S.saved || {});
      return ["title", "pitch", "play_hours", "contact", "min_wn8", "min_battles", "min_tier"].some((k) => (a[k] || "") !== (b[k] || ""))
        || [...(a.langs || [])].sort().join() !== [...(b.langs || [])].sort().join()
        || [...(a.activities || [])].sort().join() !== [...(b.activities || [])].sort().join();
    }
    function etatLigne() {
      const el = host.querySelector(".rc-state"); if (!el) return;
      const [k, txt] = S.msg || (modifie() ? ["dirty", T("Modifications non enregistrées.")] : ["", ""]);
      el.className = "rc-state" + (k ? " " + k : ""); el.textContent = txt;
    }
    async function enregistrer(status) {
      if (S.busy) return;
      lire();
      const o = S.edit;
      if (status === "active" && (o.title.length < 6 || o.pitch.length < 30)) {
        S.msg = ["err", T("Pour publier : un titre (6 caractères au moins) et une présentation (30 caractères au moins).")]; etatLigne(); return;
      }
      S.busy = true; S.msg = ["busy", T("Enregistrement…")]; etatLigne();
      const offer = { title: o.title, pitch: o.pitch, langs: o.langs, activities: o.activities, play_hours: o.play_hours,
        min_wn8: o.min_wn8, min_battles: o.min_battles, min_tier: o.min_tier, contact: o.contact, status };
      const neuve = !S.saved;
      if (!neuve) offer.id = S.saved.id;
      const r = await ctx.call("clan-offers", { session: ctx.session, action: neuve ? "create" : "save", offer });
      S.busy = false;
      if (r.ok && r.j.ok) {
        S.msg = ["ok", status === "active" ? T("Annonce publiée : elle est visible sur « Trouver un clan ».")
          : S.saved && etat(S.saved) === "ligne" ? T("Annonce mise en pause : elle n'apparaît plus sur « Trouver un clan ».") : T("Annonce enregistrée, sans être publiée.")];
        await recharger();
      } else {
        S.msg = ["err", r.status === 409 ? T("{n} annonces au plus par clan : supprime-en une pour en créer une autre.").replace("{n}", S.max)
          : r.status === 403 ? T("Ton grade ne permet pas de modifier les annonces.")
          : T("L'enregistrement a échoué : {s}.").replace("{s}", esc((r.j && r.j.error) || r.status))];
        etatLigne();
      }
    }
    async function recharger() {
      const msg = S.msg;
      const r = await ctx.call("clan-offers", { session: ctx.session, action: "mine" });
      if (r.ok) S.offers = Array.isArray(r.j.offers) ? r.j.offers : S.offers;
      S.msg = msg; liste();
    }
    async function statut(id, status) {
      if (S.busy) return; S.busy = true;
      const r = await ctx.call("clan-offers", { session: ctx.session, action: "status", id, status });
      S.busy = false;
      S.msg = r.ok ? ["ok", status === "active" ? T("Annonce remise en ligne pour {n} jours.").replace("{n}", S.life) : T("Annonce mise en pause : elle n'apparaît plus sur « Trouver un clan ».")]
        : ["err", T("L'opération a échoué : {s}.").replace("{s}", esc((r.j && r.j.error) || r.status))];
      await recharger();
    }
    async function supprimer(id) {
      const o = S.offers.find((x) => String(x.id) === String(id));
      if (!confirm(T("Supprimer définitivement l'annonce « {s} » ?").replace("{s}", (o && o.title) || T("Annonce sans titre")))) return;
      if (S.busy) return; S.busy = true;
      const r = await ctx.call("clan-offers", { session: ctx.session, action: "delete", id });
      S.busy = false;
      S.msg = r.ok ? ["ok", T("Annonce supprimée.")] : ["err", T("La suppression a échoué : {s}.").replace("{s}", esc((r.j && r.j.error) || r.status))];
      await recharger();
    }

    /* ══ Outil n°2 : les SORTIES DE CLAN, en direct ══
       Les joueurs qui viennent de quitter un clan actif en Bastion (relevé
       toutes les 15 minutes par la fonction clan-departures), filtrés selon
       les critères du clan. La liste se met à jour toute seule tant que
       l'outil est ouvert. */
    const FKEY = "cp_rec_filtres";
    const FVIDE = { days: 3, wn8: null, rating: null, wr: null, battles: null, tier10: null, active: 0, clanRank: 0, free: true, officers: false, minDays: null, tri: "recent" };
    const SO = { f: Object.assign({}, FVIDE, (() => { try { return JSON.parse(localStorage.getItem(FKEY) || "{}"); } catch (e) { return {}; } })()),
      rows: [], last: null, watched: null, loading: false, err: null, neufs: new Set(), timer: 0, req: 0, toast: "", sig: "" };
    const fSave = () => { try { localStorage.setItem(FKEY, JSON.stringify(SO.f)); } catch (e) { /* pratique, pas indispensable */ } };
    const ilya = (t) => {
      const m = Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 60000));
      return m < 1 ? T("à l'instant") : m < 60 ? T("il y a {n} min").replace("{n}", m)
        : m < 1440 ? T("il y a {n} h").replace("{n}", Math.round(m / 60)) : T("il y a {n} j").replace("{n}", Math.round(m / 1440));
    };
    // le relevé passe toutes les 15 minutes : au-delà de 45, la tâche planifiée est en retard
    const enRetard = () => SO.last && Date.now() - new Date(SO.last).getTime() > 45 * 60000;
    const liveTxt = () => !SO.last ? T("En direct · en attente du premier relevé")
      : (enRetard() ? T("Relevé en retard · dernier passage {s}") : T("En direct · dernier relevé {s}")).replace("{s}", ilya(SO.last));
    // les paliers de couleur WN8 que les joueurs connaissent (XVM, wotlabs), du rouge au violet
    const wn8Palier = (w) => [450, 900, 1200, 1600, 2000, 2900].filter((s) => w >= s).length;
    const ROLES = { commander: "Commandant", executive_officer: "Officier exécutif", deputy_commander: "Officier exécutif", personnel_officer: "Officier du personnel",
      combat_officer: "Officier de combat", intelligence_officer: "Officier renseignement", quartermaster: "Intendant", recruitment_officer: "Recruteur",
      junior_officer: "Officier subalterne", private: "Soldat", recruit: "Recrue", reservist: "Réserviste" };

    function sortiesShell(corps) {
      const f = SO.f, seg = (k, opts) => `<div class="rc-seg" data-f="${k}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${String(f[k]) === String(v)}">${T(l)}</button>`).join("")}</div>`;
      const nb = (k, l, ph, unit) => `<label class="rc-f rc-fnum"><span>${T(l)}</span><span class="rc-in"><input type="number" min="0" inputmode="numeric" name="${k}" placeholder="${esc(T(ph))}" value="${f[k] ?? ""}">${unit ? `<i>${unit}</i>` : ""}</span></label>`;
      const ann = S.offers.filter((o) => o.min_wn8 || o.min_battles || o.min_tier);
      const toast = SO.toast; SO.toast = "";
      // sur téléphone, les six critères de niveau se replient (la liste reste en vue)
      const actifs = ["wn8", "rating", "wr", "battles", "tier10", "minDays"].filter((k) => f[k]).length;
      return `<div class="rc-live${enRetard() ? " retard" : ""}"><span class="rc-dot" aria-hidden="true"></span><span class="rc-live-t">${liveTxt()}</span>
          <span class="rc-live-m">${SO.watched ? T("{n} clans actifs en Bastion suivis").replace("{n}", nf(SO.watched)) : ""}</span></div>
        ${toast ? `<p class="rc-note ok" role="status">${toast}</p>` : ""}
        <form class="rc-card rc-filtres" autocomplete="off" onsubmit="return false">
          <div class="rc-frow">
            <div class="rc-f"><span>${T("Partis depuis")}</span>${seg("days", [[1, "24 h"], [3, "3 jours"], [7, "7 jours"], [10, "10 jours"]])}</div>
            <div class="rc-f"><span>${T("Dernière bataille")}</span>${seg("active", [[0, "Peu importe"], [3, "≤ 3 j"], [7, "≤ 7 j"], [30, "≤ 30 j"]])}</div>
            <div class="rc-f"><span>${T("Clan quitté")}</span>${seg("clanRank", [[0, "Tous"], [50, "Top 50"], [200, "Top 200"], [500, "Top 500"]])}</div>
          </div>
          <details class="rc-more"${SO.plus || !(window.matchMedia && matchMedia("(max-width:640px)").matches) ? " open" : ""}>
            <summary>${T("Niveau du joueur")}${actifs ? ` <b>${actifs}</b>` : ""}</summary>
            <div class="rc-nums">
            ${nb("wn8", "WN8 minimum", "Ex : 2000")}${nb("rating", "Note Wargaming min.", "Ex : 7000")}${nb("wr", "% victoires min.", "Ex : 52", "%")}
            ${nb("battles", "Batailles minimum", "Ex : 15000")}${nb("tier10", "Chars de rang X min.", "Ex : 5")}${nb("minDays", "Jours dans son clan min.", "Ex : 30")}
            </div>
          </details>
          <div class="rc-frow rc-tog">
            <label class="rc-check"><input type="checkbox" name="free"${f.free ? " checked" : ""}><span>${T("Encore sans clan")}</span></label>
            <label class="rc-check"><input type="checkbox" name="officers"${f.officers ? " checked" : ""}><span>${T("Anciens officiers seulement")}</span></label>
            ${ann.length ? `<label class="rc-f rc-preset"><span>${T("Reprendre les critères d'une annonce")}</span><select name="preset"><option value="">—</option>${ann.map((o) => `<option value="${o.id}">${esc(o.title || T("Annonce sans titre"))}</option>`).join("")}</select></label>` : ""}
            <button type="button" class="rc-raz" data-so="reset">${T("Effacer les filtres")}</button>
          </div>
        </form>
        <div id="rcSorties">${corps}</div>`;
    }
    function ligneHTML(d) {
      const neuf = SO.neufs.has(d.id), sans = d.new_clan_id == null;
      const lang = window.CP_LANG === "en" ? "en" : "fr";
      const profil = `https://worldoftanks.eu/${lang}/community/accounts/${d.account_id}-${encodeURIComponent(d.nickname || "")}/`;
      const jours = d.joined_at ? Math.max(0, Math.round((new Date(d.left_at) - new Date(d.joined_at)) / 86400e3)) : null;
      const chips = d.enriched_at ? [
        d.wn8 != null ? `<span class="rc-stat${SO.f.wn8 ? " f" : ""}" title="${esc(T("Calculé sur {n} % des batailles (table XVM)").replace("{n}", Math.round((d.wn8_cover || 0) * 100)))}"><i>WN8</i><b class="w${wn8Palier(d.wn8)}">${nf(d.wn8)}</b>${d.wn8_cover != null && d.wn8_cover < 0.9 ? `<small>${Math.round(d.wn8_cover * 100)} %</small>` : ""}</span>` : "",
        d.global_rating != null ? `<span class="rc-stat${SO.f.rating ? " f" : ""}"><i>${T("Note WG")}</i><b>${nf(d.global_rating)}</b></span>` : "",
        d.wr != null ? `<span class="rc-stat${SO.f.wr ? " f" : ""}"><i>${T("Victoires")}</i><b>${Number(d.wr).toLocaleString(window.CP_LOC || "fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}${window.CP_LANG === "en" ? "" : " "}%</b></span>` : "",
        d.battles != null ? `<span class="rc-stat${SO.f.battles ? " f" : ""}"><i>${T("Batailles")}</i><b>${nf(d.battles)}</b></span>` : "",
        d.tier10 != null ? `<span class="rc-stat${SO.f.tier10 ? " f" : ""}"><i>${T("Rang X")}</i><b>${nf(d.tier10)}</b><small>${d.tier10 > 1 ? T("chars") : T("char")}</small></span>` : "",
        d.last_battle_at ? `<span class="rc-stat"><i>${T("Dernière bataille")}</i><b class="t">${ilya(d.last_battle_at)}</b></span>` : "",
      ].join("") : `<span class="rc-wait">${T("Profil en cours de calcul…")}</span>`;
      return `<article class="rc-dep${neuf ? " neuf" : ""}">
        <div class="rc-dep-h">
          <a class="rc-dep-n" href="${profil}" target="_blank" rel="noopener" data-i18n-skip>${esc(d.nickname || "#" + d.account_id)}</a>
          ${neuf ? `<span class="rc-pill on">${T("Nouveau")}</span>` : ""}
          ${sans ? `<span class="rc-pill libre">${T("Sans clan")}</span>` : d.new_clan_tag ? `<span class="rc-pill">${T("A rejoint")} <b data-i18n-skip>[${esc(d.new_clan_tag)}]</b></span>` : `<span class="rc-pill">${T("A rejoint un clan")}</span>`}
          <span class="rc-dep-t" title="${esc(new Date(d.left_at).toLocaleString(window.CP_LOC || "fr-FR", { dateStyle: "long", timeStyle: "short" }) + (d.left_exact ? "" : " — " + T("heure approximative")))}">${d.left_exact ? "" : "≈ "}${ilya(d.left_at)}</span>
        </div>
        <p class="rc-dep-m">${T("A quitté")} <b data-i18n-skip>[${esc(d.clan_tag || "?")}]</b>${d.clan_fb_rank ? ` <span>(${T("#{n} en Bastion").replace("{n}", nf(d.clan_fb_rank))})</span>` : ""}${d.role ? ` · ${esc(T(ROLES[d.role] || d.role))}` : ""}${jours != null ? ` · ${jours > 1 ? T("{n} jours dans le clan").replace("{n}", nf(jours)) : T("moins d'un jour dans le clan")}` : ""}</p>
        <div class="rc-stats">${chips}</div>
        <div class="rc-dep-a">
          <button type="button" class="btn" data-so="copy" data-nick="${esc(d.nickname || "")}">${T("Copier le pseudo")}</button>
          <a class="btn" href="${profil}" target="_blank" rel="noopener">${T("Profil Wargaming ↗")}</a>
        </div></article>`;
    }
    function sortiesListe() {
      const box = host.querySelector("#rcSorties"); if (!box) return;
      if (SO.err === 403) { box.innerHTML = msgbox(T("Réservé à l'état-major du clan."), ""); return; }
      if (SO.err) { box.innerHTML = msgbox(T("Les sorties de clan n'ont pas pu être chargées."), esc(String(SO.err)), `<button type="button" class="btn" data-so="reload">${T("Réessayer")}</button>`); return; }
      // pendant qu'un filtre se recharge, l'ancienne liste reste, estompée
      box.setAttribute("aria-busy", String(SO.loading));
      if (!SO.vu || (SO.loading && !SO.rows.length)) { box.innerHTML = `<div class="rc-deps">${sk("100%")}${sk("100%")}${sk("100%")}</div>`; return; }
      const L = SO.rows.slice();
      if (SO.f.tri === "wn8") L.sort((a, b) => (b.wn8 ?? -1) - (a.wn8 ?? -1));
      else if (SO.f.tri === "rating") L.sort((a, b) => (b.global_rating ?? -1) - (a.global_rating ?? -1));
      const tri = `<div class="rc-seg rc-tri" data-f="tri">${[["recent", "Plus récents"], ["wn8", "WN8"], ["rating", "Note WG"]].map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${SO.f.tri === v}">${T(l)}</button>`).join("")}</div>`;
      // le serveur renvoie les 300 départs les plus récents au plus
      const plein = L.length >= 300 ? ` <span class="rc-plein">${T("— les 300 plus récents : affine les filtres pour remonter plus loin.")}</span>` : "";
      const tete = `<div class="rc-deps-h"><p>${L.length ? (L.length > 1 ? T("<b>{n}</b> joueurs correspondent").replace("{n}", nf(L.length)) : T("<b>1</b> joueur correspond")) : ""}${plein}</p>${L.length > 1 ? tri : ""}</div>`;
      box.innerHTML = L.length ? tete + `<div class="rc-deps">${L.map(ligneHTML).join("")}</div>`
        : msgbox(SO.last ? T("Aucun départ ne correspond à ces filtres.") : T("Le premier relevé n'a pas encore eu lieu."),
          SO.last ? T("Élargis la période ou assouplis un critère : les départs arrivent toutes les 15 minutes.") : T("Les départs apparaîtront ici dès le premier passage de la tâche planifiée (toutes les 15 minutes)."));
    }
    /* La liste entière est relue à chaque fois (300 lignes au plus, une
       requête légère) : un départ déjà connu peut entre-temps recevoir son
       profil (et entrer dans un filtre WN8) ou rejoindre un clan (et sortir
       du filtre « encore sans clan »). Ce qui n'était pas là avant est « nouveau ». */
    async function sortiesCharger(direct) {
      const req = ++SO.req;
      if (!direct) { SO.loading = true; SO.err = null; sortiesListe(); }
      const f = Object.assign({}, SO.f); delete f.tri;
      const r = await ctx.call("clan-departures", { session: ctx.session, action: "list", f });
      if (req !== SO.req) return;
      SO.loading = false;
      if (r.status === 401) { if (ctx.onSignedOut) ctx.onSignedOut(); return; }
      if (!r.ok) { if (!direct) { SO.err = r.status === 403 ? 403 : ((r.j && r.j.error) || r.status); sortiesListe(); } return; }
      SO.err = null; SO.vu = true; SO.last = r.j.last_run; SO.watched = r.j.watched;
      const rows = Array.isArray(r.j.rows) ? r.j.rows : [];
      if (direct) { const connus = new Set(SO.rows.map((d) => d.id)); rows.forEach((d) => { if (!connus.has(d.id)) SO.neufs.add(d.id); }); }
      SO.rows = rows;
      const live = host.querySelector(".rc-live");
      if (live) {
        live.classList.toggle("retard", !!enRetard());
        live.querySelector(".rc-live-t").textContent = liveTxt();
        live.querySelector(".rc-live-m").textContent = SO.watched ? T("{n} clans actifs en Bastion suivis").replace("{n}", nf(SO.watched)) : "";
      }
      majOnglet();
      // sans changement, on ne redessine pas (le focus et le bouton « copié » restent en place)
      const sig = JSON.stringify(rows.map((d) => [d.id, d.enriched_at, d.new_clan_id, d.left_exact]));
      if (!direct || sig !== SO.sig) sortiesListe();
      SO.sig = sig;
    }
    // en direct : toutes les 60 secondes, tant que l'outil est à l'écran
    function sortiesDirect() {
      clearInterval(SO.timer);
      SO.timer = setInterval(() => {
        if (S.tool !== "sorties" || !host.isConnected || host.offsetParent === null || document.hidden || SO.loading) return;
        sortiesCharger(true);
      }, 60000);
    }
    function majOnglet() {
      const b = host.querySelector('[data-tool="sorties"] .n');
      if (b) { b.textContent = SO.neufs.size ? "+" + SO.neufs.size : ""; b.hidden = !SO.neufs.size; }
    }
    function sortiesOuvrir() {
      S.tool = "sorties";
      host.innerHTML = shell(sortiesShell(""));
      sortiesListe(); sortiesCharger(); sortiesDirect();
    }
    function filtresLire() {
      const f = host.querySelector(".rc-filtres"); if (!f) return;
      const n = (k) => { const v = parseInt(f.elements[k].value, 10); return Number.isFinite(v) && v > 0 ? v : null; };
      Object.assign(SO.f, { wn8: n("wn8"), rating: n("rating"), wr: n("wr"), battles: n("battles"), tier10: n("tier10"), minDays: n("minDays"),
        free: f.elements.free.checked, officers: f.elements.officers.checked });
      fSave();
      const actifs = ["wn8", "rating", "wr", "battles", "tier10", "minDays"].filter((k) => SO.f[k]).length, sum = f.querySelector(".rc-more>summary");
      if (sum) sum.innerHTML = T("Niveau du joueur") + (actifs ? ` <b>${actifs}</b>` : "");
    }
    host.addEventListener("toggle", (ev) => { if (ev.target.classList && ev.target.classList.contains("rc-more")) SO.plus = ev.target.open; }, { capture: true, signal: fin.signal });
    let filtreT = 0;
    host.addEventListener("input", (ev) => {
      if (S.tool !== "sorties" || !ev.target.closest(".rc-filtres") || ev.target.type !== "number") return;
      clearTimeout(filtreT); filtreT = setTimeout(() => { filtresLire(); SO.neufs.clear(); sortiesCharger(); }, 500);
    }, { signal: fin.signal });
    host.addEventListener("change", (ev) => {
      if (S.tool !== "sorties") return;
      if (ev.target.name === "preset") {
        const o = S.offers.find((x) => String(x.id) === ev.target.value); if (!o) return;
        // une annonce exige un WN8, des batailles, un rang de chars : on reprend ce qui se traduit en filtre
        Object.assign(SO.f, { wn8: o.min_wn8 || null, battles: o.min_battles || null, tier10: o.min_tier === 10 ? Math.max(1, SO.f.tier10 || 0) : SO.f.tier10 });
        fSave(); SO.neufs.clear();
        SO.toast = T("Critères de l'annonce « {s} » appliqués.").replace("{s}", esc(o.title || T("Annonce sans titre")));
        host.innerHTML = shell(sortiesShell("")); sortiesCharger(); return;
      }
      if (ev.target.type === "checkbox") { filtresLire(); SO.neufs.clear(); sortiesCharger(); }
    }, { signal: fin.signal });
    function sortiesClic(ev) {
      const sb = ev.target.closest(".rc-seg[data-f] button");
      if (sb) {
        const k = sb.closest(".rc-seg").dataset.f, v = sb.dataset.v;
        SO.f[k] = k === "tri" ? v : Number(v); fSave();
        sb.closest(".rc-seg").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === sb)));
        if (k === "tri") sortiesListe(); else { SO.neufs.clear(); sortiesCharger(); }
        return true;
      }
      const a = ev.target.closest("[data-so]"); if (!a) return false;
      if (a.dataset.so === "reload") sortiesCharger();
      else if (a.dataset.so === "reset") { SO.f = Object.assign({}, FVIDE); fSave(); host.innerHTML = shell(sortiesShell("")); sortiesCharger(); }
      else if (a.dataset.so === "copy") {
        const nick = a.dataset.nick;
        (navigator.clipboard ? navigator.clipboard.writeText(nick) : Promise.reject()).then(
          () => { a.textContent = T("Pseudo copié ✓"); setTimeout(() => { a.textContent = T("Copier le pseudo"); }, 1800); },
          () => { window.prompt(T("Copie le pseudo :"), nick); });
      }
      return true;
    }

    /* ── les clics ── */
    host.addEventListener("click", (ev) => {
      const outil = ev.target.closest("[data-tool]");
      if (outil) {
        if (outil.dataset.tool === "sorties" && S.tool !== "sorties") {
          if (S.mode === "edit" && modifie() && !confirm(T("Quitter sans enregistrer les modifications ?"))) return;
          S.mode = "liste"; sortiesOuvrir();
        }
        else if (outil.dataset.tool === "annonces" && S.tool !== "annonces") { S.tool = "annonces"; clearInterval(SO.timer); liste(); }
        return;
      }
      if (S.tool === "sorties") { sortiesClic(ev); return; }
      const chip = ev.target.closest(".rc-chip");
      if (chip && S.mode === "edit") {
        const on = chip.getAttribute("aria-pressed") !== "true";
        if (on && chip.dataset.lang && host.querySelectorAll('[data-group="langs"] .rc-chip[aria-pressed="true"]').length >= 4) { S.msg = ["err", T("4 langues au plus.")]; etatLigne(); return; }
        chip.setAttribute("aria-pressed", String(on)); lire(); return;
      }
      const b = ev.target.closest("[data-rc]"); if (!b || b.disabled) return;
      const a = b.dataset.rc, id = b.dataset.id;
      if (a === "reload") charger();
      else if (a === "new") { if (S.offers.length < S.max) editer(null); }
      else if (a === "edit") editer(S.offers.find((x) => String(x.id) === String(id)));
      else if (a === "list") { if (!modifie() || confirm(T("Quitter sans enregistrer les modifications ?"))) liste(); }
      else if (a === "pause") statut(id, "paused");
      else if (a === "relance") statut(id, "active");
      else if (a === "del") supprimer(id);
      else if (a === "save-live") enregistrer("active");
      else if (a === "save-draft" || a === "save-pause") enregistrer("paused");
      if (a === "new" || a === "edit" || a === "list") host.scrollIntoView({ block: "start" });
    }, { signal: fin.signal });

    charger();
    return { reload: () => (S.tool === "sorties" ? sortiesCharger() : charger()) };
  }

  window.CPRecruteur = { mount };
})();
