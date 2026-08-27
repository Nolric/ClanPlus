/* Clan Plus — le démarrage de la page « Ma progression ».

   Chargé en différé APRÈS app.js : les fonctions de calcul, de rendu et
   d'accès aux données existent donc déjà. Ce fichier ne fait que les
   enchaîner pour cette page-ci.

   Il ne refait PAS openApp() : celui-ci pilote le cadre de l'application
   — écran de connexion, barre latérale, neuf vues. Ici il n'y a qu'une
   vue, et la moitié de ce travail n'aurait nulle part où s'appliquer. */
(function () {
  "use strict";

  const montre = id => { const e = document.getElementById(id); if (e) e.classList.remove("hidden"); };
  const cache  = id => { const e = document.getElementById(id); if (e) e.classList.add("hidden"); };

  async function demarre() {
    document.documentElement.setAttribute("data-theme", "dark");

    /* Le mode test se transmet d'une page à l'autre par le même
       interrupteur qu'ailleurs — sinon la page dédiée resterait bloquée
       derrière le bandeau « en construction ». */
    const dv = new URLSearchParams(location.search).get("dev");
    if (dv != null) { if (dv === "0") localStorage.removeItem("cp_dev"); else localStorage.setItem("cp_dev", "1"); }
    if (typeof DEV !== "undefined") DEV = localStorage.getItem("cp_dev") === "1";

    const jeton = localStorage.getItem(LS_SESSION);
    if (!jeton) { cache("pgCharge"); montre("pgPorte"); return; }

    /* Trois tentatives : le serveur peut être occupé, et une page qui
       renonce au premier échec envoie l'utilisateur se reconnecter pour
       rien. */
    let res = null;
    for (let n = 1; n <= 3; n++) {
      res = await fnCall("clan-data", { session: jeton });
      if (res.ok || res.status === 401) break;
      if (n === 3) break;
      await new Promise(r => setTimeout(r, n * 1200));
    }

    cache("pgCharge");
    if (!res || !res.ok) {
      if (res && res.status === 401) localStorage.removeItem(LS_SESSION);
      montre("pgPorte");
      return;
    }

    /* La MÊME construction que dans l'application : mêmes fonctions,
       donc mêmes chiffres. C'est tout l'intérêt du fichier partagé. */
    buildRaw(res.j);
    srInit(res.j);
    MEMBERS = res.j.members || [];
    ME_ID = res.j.me ? res.j.me.account_id : null;
    CLANINFO = res.j.clanInfo || null;
    CLANRATINGS = res.j.clanRatings || null;

    const clan = res.j.clan || {};
    const t = document.getElementById("pgClan");
    if (t) t.textContent = clan.tag ? ("[" + clan.tag + "] " + (clan.name || "")) : "Ton clan";

    montre("pgApp");
    populatePlayerSel();
    const sel = document.getElementById("playerSel");
    if (sel) sel.onchange = e => { SELP = Number(e.target.value); renderPlayerView(); };
    renderPlayerView();

    /* La référence des véhicules arrive APRÈS, sans bloquer : elle ne sert
       qu à un calque de fond, et faire attendre toute la page pour une
       silhouette serait un mauvais échange. Quand elle arrive, on
       redessine. */
    try{
      const rf = await fnCall("reference", { session: jeton });
      if (rf.ok && rf.j && rf.j.tanks) { LO_REF = rf.j; renderPlayerView(); }
    }catch(_){ /* le bandeau vit très bien sans */ }
  }

  demarre().catch(e => {
    console.error("[progression]", e);
    cache("pgCharge");
    montre("pgPorte");
  });
})();
