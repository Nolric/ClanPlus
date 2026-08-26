/* ═══════════════════════════════════════════════════════════════════
   CLAN PLUS — BILINGUE

   L'anglais est écrit en dur dans le HTML. C'est un choix, pas un
   hasard : c'est la version brute du fichier que Google lit en premier,
   sans attendre d'exécuter le moindre script. Le français vit dans un
   dictionnaire, indexé PAR LA PHRASE ANGLAISE elle-même.

   Pourquoi pas des clés (`accueil.titre.1`) : parce qu'elles se
   décalent. On remanie un paragraphe, la clé ne correspond plus à rien,
   et personne ne s'en aperçoit avant qu'un visiteur voie « accueil.
   titre.1 » s'afficher. Ici, une phrase sans traduction reste en
   anglais : c'est visible, c'est lisible, et ça ne casse rien.

   TROIS FAÇONS DE TRADUIRE, selon d'où vient le texte :
     · le HTML statique    → parcouru et remplacé au chargement
     · les attributs       → placeholder, title, aria-label, alt, metas
     · le JavaScript       → t("English sentence") dans le code

   AJOUTER UNE PHRASE : on l'écrit en anglais dans le HTML, on ajoute
   une ligne dans le dictionnaire de la page. Rien d'autre.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  /* ── Deux dictionnaires, deux sens ────────────────────────────────
     Les pages publiques sont écrites en anglais dans le fichier — c'est
     ce que Google lit — et CP_FR les repasse en français.

     L'application, elle, est écrite en français : elle vit derrière la
     connexion, aucun moteur de recherche ne la voit, et réécrire 1 300
     phrases dispersées dans des gabarits de 692 ko aurait été un risque
     sans contrepartie. C'est donc CP_EN qui la fait passer en anglais.

     Le moteur ne se demande pas dans quelle zone il travaille : en
     français il applique CP_FR, en anglais CP_EN. Une phrase déjà dans
     la bonne langue ne correspond à aucune clé et reste intacte. */
  var CP_FR = window.CP_FR || (window.CP_FR = {});   // anglais → français
  var CP_EN = window.CP_EN || (window.CP_EN = {});   // français → anglais
  var CLE = "cp_lang";

  /* ── Quelle langue ? ──────────────────────────────────────────────
     L'URL tranche en premier — c'est elle qu'on partage et qu'on
     indexe. Puis le choix mémorisé. Puis la langue du navigateur : un
     visiteur francophone qui arrive de Google tombe sur du français
     sans avoir rien à cliquer. Au bout de la chaîne, l'anglais. */
  function detecte() {
    var p = new URLSearchParams(location.search).get("lang");
    if (p === "fr" || p === "en") return p;
    var m = null;
    try { m = localStorage.getItem(CLE); } catch (e) { }
    if (m === "fr" || m === "en") return m;
    var n = (navigator.languages && navigator.languages[0]) || navigator.language || "";
    return /^fr\b/i.test(n) ? "fr" : "en";
  }

  var LANG = detecte();
  var FR = LANG === "fr";
  window.CP_LANG = LANG;

  /* La locale, pour tout ce que le navigateur sait formater lui-même :
     dates, heures, séparateur de milliers, virgule décimale. Une seule
     valeur ici évite douze entrées de dictionnaire pour les mois et
     autant pour les jours de la semaine — et elle donne « 1,712 » à un
     lecteur anglais là où le français lit « 1 712 ». */
  window.CP_LOC = FR ? "fr-FR" : "en-GB";

  /* Le dictionnaire qui s'applique ici, et rien à faire s'il est vide —
     une page anglaise lue en anglais n'a aucun travail à fournir. */
  var DICO = FR ? CP_FR : CP_EN;
  var ACTIF = false;
  for (var _k in DICO) { if (Object.prototype.hasOwnProperty.call(DICO, _k)) { ACTIF = true; break; } }

  /* La traduction d'une phrase, ou la phrase elle-même. Sert au
     JavaScript qui fabrique du texte : t("No clan yet"). */
  window.t = function (src) {
    if (!ACTIF) return src;
    var v = DICO[String(src).replace(/\s+/g, " ").trim()];
    return v === undefined ? src : v;
  };

  /* ── L'attente ────────────────────────────────────────────────────
     Le lecteur verrait sinon la langue du fichier une fraction de
     seconde avant la bascule. On masque le corps le temps du
     remplacement — uniquement quand il y a un remplacement à faire.

     Le masquage est posé par script et retiré par script, avec un
     garde-fou : si quoi que ce soit échoue, la page réapparaît au bout
     de 1,2 s. Jamais de contenu caché par le seul CSS. */
  var garde = null;
  if (ACTIF) {
    var st = document.createElement("style");
    st.id = "cpI18nWait";
    st.textContent = "html.cp-i18n-wait body{visibility:hidden}";
    (document.head || document.documentElement).appendChild(st);
    document.documentElement.className += " cp-i18n-wait";
    garde = setTimeout(montre, 1200);
  }
  function montre() {
    clearTimeout(garde);
    document.documentElement.className =
      document.documentElement.className.replace(/\s*cp-i18n-wait\b/g, "");
  }

  var norm = function (t) { return String(t).replace(/\s+/g, " ").trim(); };

  /* ── Les balises « en ligne » ─────────────────────────────────────
     Miroir exact de l'analyseur qui a produit le dictionnaire : c'est
     ce qui garantit qu'une clé calculée ici tombe sur la même clé que
     celle calculée à l'extraction. */
  var ENLIGNE = {};
  "B STRONG I EM U S SPAN A CODE KBD SAMP VAR SMALL SUP SUB ABBR TIME MARK BR WBR Q CITE BDI BDO DEL INS OUTPUT DATA"
    .split(" ").forEach(function (t) { ENLIGNE[t] = 1; });
  var OPAQUE = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1, CODE: 0 };

  function toutEnLigne(el) {
    var k = el.children;
    for (var i = 0; i < k.length; i++) {
      if (!ENLIGNE[k[i].tagName]) return false;
      if (!toutEnLigne(k[i])) return false;
    }
    return true;
  }

  /* ── Le filet de rattrapage ───────────────────────────────────────
     La clé principale est l'innerHTML, balises comprises. Un jour où
     l'autre le navigateur écrira une balise autrement que le fichier
     source — un attribut nu qui devient attr="", une entité réécrite —
     et la clé ne tombera plus. Cet index secondaire retrouve la phrase
     par son TEXTE SEUL, qui ne dépend d'aucune sérialisation.

     Une phrase dont le texte est ambigu (deux entrées différentes, même
     texte nu) est retirée de l'index : mieux vaut ne rien traduire que
     traduire de travers. */
  var SECOURS = null;
  function secours() {
    if (SECOURS) return SECOURS;
    SECOURS = {};
    var ambigus = {};
    for (var k in DICO) {
      if (!Object.prototype.hasOwnProperty.call(DICO, k)) continue;
      var nu = norm(k.replace(/<[^>]*>/g, " "));
      if (!nu) continue;
      if (SECOURS[nu] !== undefined && SECOURS[nu] !== DICO[k]) { ambigus[nu] = 1; continue; }
      SECOURS[nu] = DICO[k];
    }
    for (var a in ambigus) delete SECOURS[a];
    return SECOURS;
  }

  /* ── Les motifs ───────────────────────────────────────────────────
     « +42 % vs moyenne », « +37 % vs moyenne » ne sont pas deux
     phrases : c'est une phrase et deux chiffres. Une clé exacte n'en
     attraperait aucune chez un vrai clan, où les chiffres sont autres.

     Une clé qui contient {n} est donc un MOTIF : {n} tient la place
     d'un nombre, capturé à la lecture et réinjecté dans la traduction,
     dans l'ordre. « +{n} % vs moyenne » couvre tous les cas, ceux
     d'aujourd'hui comme ceux de la saison prochaine.

     Les motifs ne sont essayés que lorsque la clé exacte a échoué, et
     un pré-filtre sur le plus long morceau de texte fixe évite de
     lancer cent expressions régulières par phrase. */
  /* Trois marques, du plus étroit au plus large :
       {n} un nombre        — « +{n} % vs moyenne »
       {t} un tag de clan   — « {t} — {n} victoires sur {n} rencontres »
       {s} un nom quelconque, sans balise — « <b>{s}</b> est ta carte… »
     {s} est le plus permissif : on ne s'en sert que bordé de texte fixe
     ou de balises, jamais seul, sinon il avalerait la phrase entière. */
  var MARQUES = {
    "{n}": "(\\d+(?:[\\s\\u00a0\\u202f]\\d{3})*(?:[.,]\\d+)?)",
    "{t}": "(\\[[^\\]]{1,10}\\])",
    "{s}": "([^<>]*?)",
  };
  var COUPE = /(\{[nts]\})/;
  var MOTIFS = null;

  function echappe(t) { return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  function motifs() {
    if (MOTIFS) return MOTIFS;
    MOTIFS = [];
    for (var k in DICO) {
      if (!Object.prototype.hasOwnProperty.call(DICO, k)) continue;
      if (!/\{[nts]\}/.test(k)) continue;
      var bouts = k.split(COUPE);
      var re = "", amorce = "";
      for (var i = 0; i < bouts.length; i++) {
        if (MARQUES[bouts[i]]) { re += MARQUES[bouts[i]]; continue; }
        re += echappe(bouts[i]);
        if (bouts[i].length > amorce.length) amorce = bouts[i];   // pré-filtre
      }
      try {
        MOTIFS.push({
          re: new RegExp("^" + re + "$"), sortie: DICO[k],
          amorce: amorce.length >= 4 ? amorce : "",
        });
      } catch (e) { /* un motif illisible ne doit pas emporter le reste */ }
    }
    /* les motifs les plus spécifiques d'abord : un {s} large ne doit pas
       coiffer un motif exact qui aurait mieux collé */
    MOTIFS.sort(function (a, b) { return b.amorce.length - a.amorce.length; });
    return MOTIFS;
  }

  function parMotif(txt) {
    var L = motifs();
    for (var i = 0; i < L.length; i++) {
      if (L[i].amorce && txt.indexOf(L[i].amorce) < 0) continue;
      var m = L[i].re.exec(txt);
      if (!m) continue;
      /* les captures reviennent DANS L'ORDRE : la traduction doit donc
         porter ses marques dans le même ordre que l'original */
      var k = 0;
      return L[i].sortie.replace(/\{[nts]\}/g, function (mk) {
        k++; return m[k] === undefined ? mk : m[k];
      });
    }
    return undefined;
  }

  /* ── Le remplacement ──────────────────────────────────────────────
     Deux passes. D'abord les éléments entiers : un <p> avec du gras
     dedans se traduit d'un bloc, balises comprises, sans quoi l'ordre
     des mots serait figé sur l'anglais. Ensuite les nœuds de texte
     esseulés — le libellé d'un bouton qui porte aussi une icône. */
  /* Du texte explicitement marqué dans une autre langue reste dans
     cette langue. C'est le cas des libellés de l'interface du jeu, qui
     sont en anglais À L'ÉCRAN, y compris pour un joueur français :
     « Clan Wars simulation mode » est ce qu'il lit dans World of Tanks,
     le traduire l'enverrait chercher une case qui n'existe pas. */
  function etranger(el) {
    var p = el.closest("[lang]");
    return !!p && p.tagName !== "HTML" && p.getAttribute("lang") !== LANG;
  }

  function traduit(racine) {
    if (!ACTIF || !racine) return;
    var faits = [];

    /* La racine elle-même compte : quand l'application ajoute un bloc
       déjà rempli, c'est LUI la phrase, pas un de ses descendants. */
    var tous = [].slice.call(racine.querySelectorAll("*"));
    if (racine.nodeType === 1 && racine !== document.body) tous.unshift(racine);
    for (var i = 0; i < tous.length; i++) {
      var el = tous[i];
      if (OPAQUE[el.tagName] || el.hasAttribute("data-i18n-skip")) continue;
      if (el.closest("[data-i18n-skip]")) continue;
      if (etranger(el)) continue;
      if (!el.textContent || !norm(el.textContent)) continue;
      if (!toutEnLigne(el)) continue;
      /* déjà pris en charge par un parent traduit d'un bloc */
      var couvert = false;
      for (var j = 0; j < faits.length; j++) {
        if (faits[j].contains(el)) { couvert = true; break; }
      }
      if (couvert) continue;

      /* Clé exacte, puis texte seul, puis motif. Si rien ne prend, on
         NE marque pas l'élément comme fait : la boucle descendra dans
         ses enfants. C'est ce qui sauve les blocs mêlant une donnée et
         du texte — le chiffre est dans un enfant, la phrase dans un
         autre, et l'enfant, lui, a une clé stable. */
      var cle = norm(el.innerHTML);
      var v = DICO[cle], parRegle = false;
      if (v === undefined) v = secours()[norm(el.textContent)];
      if (v === undefined) { v = parMotif(cle); parRegle = v !== undefined; }
      if (v === undefined) continue;

      el.innerHTML = v;
      faits.push(el);

      /* Une marque réémet CE QU'ELLE A CAPTURÉ, tel quel. Dans « Ton
         point fort : <span>échange</span> », {s} rend « échange » — un
         mot français au milieu d'une phrase anglaise. On repasse donc à
         l'intérieur de ce que le motif vient d'écrire.

         Pas de boucle possible : le contenu est désormais anglais, et
         aucune clé française ne peut plus y correspondre. */
      if (parRegle && el.children.length) traduit(el);
    }

    /* Les nœuds de texte que rien n'a couvert — le libellé d'un bouton
       qui porte aussi une icône, typiquement.

       Cette passe lit le DOM APRÈS la précédente : sans la garde sur
       `faits`, elle repartirait à l'intérieur des blocs déjà traduits et
       retraduirait leur contenu mot à mot. C'est ainsi que le libellé
       anglais du jeu s'était retrouvé traduit à l'intérieur d'un
       paragraphe pourtant correct. */
    var w = document.createTreeWalker(racine, NodeFilter.SHOW_TEXT, null);
    var n, restants = [];
    while ((n = w.nextNode())) {
      if (!norm(n.nodeValue)) continue;
      var p = n.parentNode;
      if (!p || OPAQUE[p.tagName]) continue;
      if (p.closest && p.closest("[data-i18n-skip]")) continue;
      if (p.closest && etranger(p)) continue;
      var dedans = false;
      for (var y = 0; y < faits.length; y++) if (faits[y].contains(n)) { dedans = true; break; }
      if (dedans) continue;
      restants.push(n);
    }
    for (var q = 0; q < restants.length; q++) {
      var nd = restants[q], brut = norm(nd.nodeValue);
      var val = DICO[brut];
      if (val === undefined) val = parMotif(brut);
      if (val === undefined) continue;
      /* on garde les espaces d'origine autour : ils portent la mise en page */
      var g = nd.nodeValue.match(/^\s*/)[0], d = nd.nodeValue.match(/\s*$/)[0];
      nd.nodeValue = g + val + d;
    }

    /* Le texte dessiné dans les illustrations. Les <svg> sont écartés
       des passes précédentes — à raison, on ne veut pas d'un tracé de
       deux kilo-octets en guise de clé — mais un <text> à l'intérieur
       est bel et bien lu par le visiteur. « ÉLIMINATIONS » était resté
       en français sur une page par ailleurs entièrement traduite, et
       rien ne l'avait signalé. */
    var dess = racine.querySelectorAll("svg text, svg tspan");
    for (var g = 0; g < dess.length; g++) {
      if (dess[g].querySelector("tspan") || etranger(dess[g])) continue;
      var cg = norm(dess[g].textContent);
      var vg = DICO[cg];
      if (vg === undefined) vg = parMotif(cg);
      if (vg !== undefined) dess[g].textContent = vg;
    }

    /* les attributs lus par un humain ou par un lecteur d'écran */
    var ATTRS = ["placeholder", "title", "aria-label", "aria-description", "alt", "label"];
    for (var a = 0; a < tous.length; a++) {
      if (etranger(tous[a])) continue;
      for (var b = 0; b < ATTRS.length; b++) {
        var cur = tous[a].getAttribute(ATTRS[b]);
        if (!cur) continue;
        var cn = norm(cur);
        var tr = DICO[cn];
        /* Les motifs valent ici aussi : une infobulle porte presque
           toujours un chiffre — « Rank {n} », « Emblème {s} », « À
           renforcer — {n} et plus ». Sans cette ligne, tout le texte
           lu par un lecteur d'écran restait en français. */
        if (tr === undefined) tr = parMotif(cn);
        if (tr !== undefined) tous[a].setAttribute(ATTRS[b], tr);
      }
    }
  }
  window.cpTraduit = traduit;

  /* ── Ce qui arrive après le chargement ────────────────────────────
     L'application est une page unique : elle efface et redessine ses
     vues en permanence. Traduire une fois au chargement ne couvrirait
     que le premier écran — le reste apparaîtrait dans la langue du
     code.

     On surveille donc les ajouts au document. Deux précautions :
     · nos propres écritures déclenchent l'observateur à leur tour ;
       le drapeau `enCours` évite la boucle sans fin ;
     · on regroupe par courtes rafales, sinon un rendu de tableau
       lancerait une passe par ligne insérée. */
  var enCours = false, attente = null, aFaire = [];

  var balayage = null;

  function videLot() {
    attente = null;
    var lot = aFaire; aFaire = [];
    enCours = true;
    try {
      for (var i = 0; i < lot.length; i++) {
        var n = lot[i];
        if (n.isConnected !== false) traduit(n);
      }
    } catch (e) { console.error("[i18n]", e); }
    enCours = false;

    /* ── Le filet ───────────────────────────────────────────────────
       Pendant qu'on écrit, l'observateur est sourd — il le faut, sinon
       nos propres écritures relanceraient la traduction sans fin. Mais
       si l'application redessine JUSTE à ce moment-là, sa modification
       passe à la trappe et la phrase reste dans la langue du code.

       Une fois l'agitation retombée, on repasse donc sur toute la page.
       C'est un balayage complet, mais il n'arrive qu'une fois par
       rafale : le coût est celui d'un rendu, la garantie est totale. */
    clearTimeout(balayage);
    balayage = setTimeout(function () {
      enCours = true;
      try { traduit(document.body); } catch (e) { console.error("[i18n]", e); }
      enCours = false;
    }, 350);
  }

  function surveille() {
    if (!ACTIF || !window.MutationObserver || !document.body) return;
    new MutationObserver(function (muts) {
      if (enCours) return;
      for (var i = 0; i < muts.length; i++) {
        var ns = muts[i].addedNodes;
        for (var j = 0; j < ns.length; j++) {
          if (ns[j].nodeType === 1) aFaire.push(ns[j]);
          else if (ns[j].nodeType === 3 && muts[i].target) aFaire.push(muts[i].target);
        }
        /* Le texte modifié EN PLACE — `nœud.nodeValue = "…"` — n'ajoute
           aucun nœud : sans cette ligne, un compteur ou un verdict
           réécrit de la sorte restait en français. */
        if (!ns.length && muts[i].target) {
          aFaire.push(muts[i].target.nodeType === 3 ? muts[i].target.parentNode : muts[i].target);
        }
      }
      if (aFaire.length && !attente) attente = setTimeout(videLot, 60);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  /* ── L'en-tête du document ────────────────────────────────────────
     Le titre, la description, les cartes de partage. Et surtout les
     balises hreflang : elles disent à Google que les deux versions
     existent et laquelle servir à qui. Sans elles, les deux langues se
     concurrencent sur les mêmes mots-clés. */
  function entete() {
    var url = location.origin + location.pathname;
    var doc = document.documentElement;
    doc.setAttribute("lang", LANG);

    /* le titre et les cartes de partage, dans le sens qui s'applique */
    if (ACTIF) {
      var ti = DICO[norm(document.title)];
      if (ti !== undefined) document.title = ti;
      ["description", "twitter:title", "twitter:description"].forEach(function (k) {
        var m = document.querySelector('meta[name="' + k + '"]');
        if (!m) return;
        var v = DICO[norm(m.content)]; if (v !== undefined) m.content = v;
      });
      ["og:title", "og:description"].forEach(function (k) {
        var m = document.querySelector('meta[property="' + k + '"]');
        if (!m) return;
        var v = DICO[norm(m.content)]; if (v !== undefined) m.content = v;
      });
    }
    var loc = document.querySelector('meta[property="og:locale"]');
    if (loc) loc.content = FR ? "fr_FR" : "en_GB";
    if (FR) {
      /* chaque langue est canonique d'elle-même, sinon l'une efface l'autre */
      var can = document.querySelector('link[rel="canonical"]');
      if (can) can.href = url + "?lang=fr";
      var ogu = document.querySelector('meta[property="og:url"]');
      if (ogu) ogu.content = url + "?lang=fr";
    }

    [["en", url], ["fr", url + "?lang=fr"], ["x-default", url]].forEach(function (p) {
      if (document.querySelector('link[hreflang="' + p[0] + '"]')) return;
      var l = document.createElement("link");
      l.rel = "alternate"; l.hreflang = p[0]; l.href = p[1];
      document.head.appendChild(l);
    });
  }

  /* ── Le sélecteur ─────────────────────────────────────────────────
     Deux jetons, EN et FR, dans la barre du haut. Il change l'URL au
     lieu de basculer le texte sur place : la page se recharge dans la
     bonne langue, l'adresse est partageable, et elle correspond
     exactement à ce que hreflang a annoncé. Un aller-retour serveur
     coûte moins qu'un état à moitié traduit. */
  function styleSelecteur() {
    if (document.getElementById("cpLangCss")) return;
    var css = document.createElement("style");
    css.id = "cpLangCss";
    css.textContent =
      ".cp-lang{display:inline-flex;align-items:center;gap:1px;margin-left:10px;" +
      "border:1px solid var(--rule,#232120);border-radius:3px;overflow:hidden;flex:0 0 auto}" +
      ".cp-lang a{display:block;padding:5px 9px;font:600 10px/1 var(--d-mono,ui-monospace,monospace);" +
      "letter-spacing:.11em;color:var(--ink-3,#8d8a80);text-decoration:none;background:transparent;" +
      "transition:color .15s,background .15s}" +
      ".cp-lang a:hover{color:var(--ink,#f7f6f2);background:var(--steel-2,rgba(255,255,255,.05))}" +
      ".cp-lang a[aria-current]{color:var(--gold,#d8b566);background:rgba(216,181,102,.12)}" +
      ".cp-lang-flot{position:fixed;top:12px;right:12px;z-index:9998;margin:0;" +
      "background:rgba(10,10,9,.82);backdrop-filter:blur(6px)}" +
      "@media(max-width:620px){.cp-lang{margin-left:6px}.cp-lang a{padding:5px 7px}}";
    document.head.appendChild(css);
  }

  function pose(hote, flottant) {
    if (!hote || hote.querySelector(".cp-lang")) return;
    styleSelecteur();
    var base = location.pathname + location.hash;
    var d = document.createElement("div");
    d.className = "cp-lang" + (flottant ? " cp-lang-flot" : "");
    d.setAttribute("data-i18n-skip", "");
    d.setAttribute("role", "group");
    d.setAttribute("aria-label", FR ? "Langue" : "Language");
    d.innerHTML =
      '<a href="' + base + '" data-l="en"' + (FR ? "" : ' aria-current="true"') + ' lang="en">EN</a>' +
      '<a href="' + location.pathname + '?lang=fr' + location.hash + '" data-l="fr"' +
      (FR ? ' aria-current="true"' : "") + ' lang="fr">FR</a>';
    /* on mémorise le choix avant de suivre le lien : le prochain accès
       direct, sans paramètre, retrouvera la bonne langue */
    d.addEventListener("click", function (ev) {
      var a = ev.target.closest("a[data-l]");
      if (!a) return;
      try { localStorage.setItem(CLE, a.getAttribute("data-l")); } catch (e) { }
    });
    hote.appendChild(d);
  }

  function selecteur() {
    /* Une page peut porter DEUX interfaces — l'accueil public et
       l'application connectée, dans le même fichier. Un sélecteur unique
       finirait caché dans celle qui ne s'affiche pas ; on en pose donc un
       dans chaque emplacement déclaré. */
    var slots = document.querySelectorAll(".cp-lang-slot");
    if (slots.length) {
      for (var z = 0; z < slots.length; z++) pose(slots[z], false);
      return;
    }
    var hote = document.getElementById("cpLang") ||
      document.querySelector(".top-in") || document.querySelector(".nav-r") ||
      document.querySelector(".lnav-in") || document.querySelector("nav");
    /* Dernier recours : une page sans barre de navigation — le
       visualiseur 3D, par exemple — se retrouvait SANS aucun moyen de
       changer de langue. Plutôt que d'abandonner en silence, on pose le
       sélecteur en flottant. Mieux vaut un bouton mal placé qu'un
       visiteur bloqué dans une langue qu'il ne lit pas. */
    pose(hote || document.body, !hote);
  }

  /* ── Mise en route ────────────────────────────────────────────────
     Le dictionnaire est chargé par une balise <script> qui précède
     celle-ci, donc il est déjà là. Reste à attendre le corps. */
  function demarre() {
    try {
      entete();
      enCours = true; traduit(document.body); enCours = false;
      selecteur();
      surveille();
    } catch (e) { enCours = false; console.error("[i18n]", e); }
    montre();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", demarre);
  } else { demarre(); }
})();
