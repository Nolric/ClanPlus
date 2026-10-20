/* ═══════════════════════════════════════════════════════════════════
   ESPACE RECRUTEUR — module partagé (20/10/2026)
   Un seul module, deux portes (décision de Robert) : l'onglet « Espace
   recruteur » de l'appli, et le bouton du même nom sur la page publique
   « Trouver un clan ». Deux copies du formulaire auraient divergé au
   premier changement.

   L'espace accueillera plusieurs outils ; le premier est la gestion des
   ANNONCES DE RECRUTEMENT : 3 au plus par clan, chacune en ligne ou en
   pause, et une annonce non mise à jour depuis 30 jours sort de la page
   publique jusqu'à ce qu'on la remette en ligne (fonction clan-offers).

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
    const S = { offers: [], max: 3, life: 30, clan: ctx.clan || null, ratings: ctx.ratings || null,
      tool: "annonces", mode: "liste", edit: null, saved: null, msg: null, busy: false };

    /* ── la coquille : le titre, puis un onglet par outil ── */
    function shell(corps, nb) {
      return `<h2 class="sec-h">Espace recruteur</h2>
        <p class="sec-desc">Les outils de recrutement de ton clan. Ce que tu publies ici apparaît sur la page publique « Trouver un clan », vue par tous les joueurs qui cherchent un clan.</p>
        <nav class="rc-tabs" role="tablist" aria-label="Outils du recruteur">
          <button type="button" role="tab" aria-selected="${S.tool === "annonces"}" data-tool="annonces"><span>Annonces de recrutement</span>${nb != null ? `<span class="n">${nb} / ${S.max}</span>` : ""}</button>
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
      liste();
      // l'emblème, les membres et les cotes, quand la page sait les chercher
      if (ctx.loadClan && S.clan && S.clan.id && (S.clan.em == null || !S.ratings)) {
        try { const x = await ctx.loadClan(S.clan.id); Object.assign(S.clan, { em: x.em, m: x.m }); S.ratings = x.ratings || S.ratings; if (S.mode === "liste") liste(); else apercu(); } catch (e) { /* l'aperçu s'en passe */ }
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

    /* ── les clics ── */
    host.addEventListener("click", (ev) => {
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
    });

    charger();
    return { reload: charger };
  }

  window.CPRecruteur = { mount };
})();
