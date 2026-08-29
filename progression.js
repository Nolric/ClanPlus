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

    /* ── En construction, sauf en mode test ────────────────────────
       On barre AVANT d'appeler clan-data : charger les données d'un clan
       pour les jeter ensuite coûterait une requête à chaque visite d'un
       membre qui ne verra rien. Le bandeau est celui de l'application
       (.wip-msg), pas un second dessin. */
    if (!(typeof DEV !== "undefined" && DEV)) {
      cache("pgCharge");
      const p = document.getElementById("pgPorte");
      if (p) {
        p.innerHTML =
          '<div class="wip-msg">' +
            '<div class="wip-ic">🚧</div>' +
            /* Le bandeau passe par t() comme le reste : il est injecté par
               script, donc APRÈS le passage du traducteur sur le document,
               et resterait sinon en français pour un lecteur anglais. */
            '<h3>' + t("Ma progression — en construction") + '</h3>' +
            '<p>' + t("Cette page est en cours de refonte : les données et le plan de progression sont en train d'être repensés.") +
              '<br>' + t("Elle sera ouverte à tout le clan dès qu'elle sera prête.") + '</p>' +
            '<p style="margin-top:16px"><a href="index.html" class="btn">' +
              t("Retour à Clan Plus") + '</a></p>' +
          '</div>';
        p.classList.remove("hidden");
      }
      return;
    }

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
    /* La hauteur reelle de la barre du haut : le bandeau plein ecran la
       retranche. Mesuree plutot que codee en dur, elle suit la langue et
       la taille de police du systeme. */
    const mesureBarre = () => {
      const h = document.querySelector(".pg-top");
      if (h) document.documentElement.style.setProperty(
        "--pg-top", Math.ceil(h.getBoundingClientRect().height) + "px");
      /* ceil et non round : arrondir vers le bas fait retrancher moins que
         la hauteur reelle, et le bandeau depasse de la difference. Mieux
         vaut un pixel de trop en moins qu un pixel de trop en plus. */
    };
addEventListener("resize", mesureBarre, { passive: true });;

    /* Surtout pas « t » : c'est le nom de la fonction de traduction. Une
       variable locale ainsi nommée la rend inaccessible dans TOUTE la
       portée, y compris en amont de sa déclaration — le bandeau « en
       construction » plus haut levait « Cannot access 't' before
       initialization » à cause de cette seule ligne. */
    const titreClan = document.getElementById("pgClan");
    if (titreClan) titreClan.textContent =
      clan.tag ? ("[" + clan.tag + "] " + (clan.name || "")) : "Ton clan";

    montre("pgApp");
    /* APRÈS l'affichage : un élément caché mesure zéro, et le bandeau
       plein écran aurait retranché zéro — donc dépassé de la hauteur de
       la barre, poussant la barre d'étapes sous la ligne de flottaison. */
    mesureBarre();
    /* Une mesure unique ne suffit pas : la barre change de hauteur APRÈS
       le premier rendu — les polices finissent de charger, et sous 620 px
       le nom du clan disparaît. Mesurée à 43 px puis devenue 47, elle
       laissait le bandeau dépasser de quatre pixels. On l'observe donc
       au lieu de la mesurer une fois. */
    if (window.ResizeObserver) new ResizeObserver(mesureBarre)
      .observe(document.querySelector(".pg-top"));
    
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
