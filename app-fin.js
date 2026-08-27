/* Clan Plus — les compléments de fin de page
   Sorti de index.html pour être partagé avec progression.html : il ne
   doit exister qu'UNE version des règles de calcul du SR, du coach et
   des cartes. Deux copies auraient dérivé.
   Chargé en différé, donc après lecture complète de la page. */

/* ── récit + mise en scène du tableau de bord ── */

(function(){
  var doux = (typeof REDUCE_MOTION !== "undefined" && REDUCE_MOTION) ||
             (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

  /* ── corrections mesurées ─────────────────────────────────────── */
  function majTitre(){
    var on = document.querySelector(".side-item.on .si-lbl");
    var t = document.getElementById("clanTitle"), s = document.getElementById("clanSub");
    if(!t || !s) return;
    t.textContent = on ? on.textContent.trim() : "Vue clan";
    s.textContent = (typeof CLANINFO !== "undefined" && CLANINFO)
      ? "[" + CLANINFO.tag + "] " + (CLANINFO.name || "") : "Statistiques Bastion";
  }
  var nav = document.getElementById("nav");
  if(nav) nav.addEventListener("click", function(){ setTimeout(majTitre, 0); });
  majTitre();

  [["clan","Le clan"],["lineups","Préparer"],["ranking","Ailleurs"]].forEach(function(f){
    var c = document.querySelector('.side-item[data-v="' + f[0] + '"]');
    if(!c || (c.previousElementSibling && c.previousElementSibling.className === "nav-sec")) return;
    var h = document.createElement("div"); h.className = "nav-sec"; h.textContent = f[1];
    c.parentNode.insertBefore(h, c);
  });
  var sect = document.querySelectorAll("#viewClan .d2sect");
  for(var i=0;i<sect.length;i++){
    if(sect[i].textContent.indexOf("Wargaming") >= 0 && !sect[i].querySelector(".src")){
      var sp = document.createElement("span"); sp.className = "src";
      sp.textContent = "source : API Wargaming"; sect[i].appendChild(sp); break;
    }
  }

  /* ── LE VERDICT ───────────────────────────────────────────────────
     Tout est calculé avec les fonctions de l'app (dashStats,
     dashFilterRows, dashBattleList, aggregate) : aucune valeur inventée.
     Si quoi que ce soit manque, on n'affiche rien plutôt qu'un mensonge. */
  /* ⚠️ placeSubbar("clan") DÉPLACE la barre de filtres DANS #dashSub.
     Écrire dans hote.innerHTML la ferait donc disparaître. On travaille
     dans notre propre section, ajoutée à la suite. */
  /* On ne crée la section QUE s'il y a quelque chose à dire : sur la page
     d'accueil publique, #dashSub existe déjà (dans #app masqué) et on y
     laisserait sinon une plaque vide à demeure. */
  function bloc(creer){
    var hote = document.getElementById("dashSub");
    if(!hote) return null;
    var b = document.getElementById("cpVerdict");
    if(!b && creer){ b = document.createElement("section"); b.id = "cpVerdict"; b.className = "vd";
                     hote.appendChild(b); }
    return b;
  }
  function efface(){
    var b = bloc(false);
    if(b){ b.hidden = true; b.innerHTML = ""; }
    var v = document.getElementById("viewClan");
    if(v) v.classList.remove("cp-verdict");
  }
  function ecrisVerdict(){
    if(typeof dashStats !== "function" || !document.getElementById("dashSub")) return;
    var hote = null;
    try{
      var cur = dashStats(dashFilterRows(state.days, 0));
      if(!cur.tot){ efface(); return; }
      hote = bloc(true);
      if(!hote) return;
      var pct = Math.round(cur.winrate * 100);

      /* La tendance n'a de sens qu'entre deux fenêtres DE MÊME DURÉE.
         Sur « Tout », il n'y a pas de période précédente comparable :
         on n'affiche donc aucune tendance plutôt qu'une fausse. */
      var fen = state.days, dpts = null;
      if(fen){
        var pre = dashStats(dashFilterRows(fen, 1));
        if(pre.tot >= 5) dpts = Math.round((cur.winrate - pre.winrate) * 100);
      }

      /* la série en cours */
      var liste = dashBattleList().filter(function(b){ return b.result != null && b.result !== -1; });
      var serie = 0, gagne = null;
      for(var k=0;k<liste.length;k++){
        var w = liste[k].result === 1;
        if(gagne === null){ gagne = w; serie = 1; } else if(w === gagne) serie++; else break;
      }

      /* le verdict lui-même : ce que les chiffres VEULENT DIRE */
      var titre;
      if(dpts != null && dpts >= 4)        titre = "Le clan <em>monte</em>.";
      else if(dpts != null && dpts <= -4)  titre = "Le clan <em>recule</em>.";
      else if(pct >= 60)                   titre = "Le clan <em>tient sa ligne</em>.";
      else if(pct >= 50)                   titre = "Le clan <em>fait jeu égal</em>.";
      else                                 titre = "Le clan <em>cherche son rythme</em>.";

      var per = state.days ? ("sur " + state.days + " jours") : "depuis le début";
      var ph = "<b>" + cur.wins + " victoires</b> pour <b>" + (cur.tot - cur.wins) +
               " défaites</b> " + per + ".";
      if(dpts != null && Math.abs(dpts) >= 1){
        ph += ' C\'est <span class="' + (dpts>0?"up":"dn") + '">' + (dpts>0?"+":"−") +
              Math.abs(dpts) + " points</span> par rapport aux " + fen + " jours précédents.";
      }
      if(serie >= 3){
        ph += " " + (gagne ? "<b>" + serie + " victoires d'affilée</b> en ce moment."
                           : "<b>" + serie + " défaites d'affilée</b> à casser.");
      }


      /* la forme récente : dix barres, la plus ancienne à gauche.
         Calculées ici car la courbe les intègre à son en-tête. */
      var dix = liste.slice(0, 10).reverse().map(function(b, j){
        return '<i class="' + (b.result===1?"v":"d") + '" style="--i:' + j +
               ';height:' + (b.result===1?26:14) + 'px" title="' +
               (b.result===1?"Victoire":"Défaite") + '"></i>';
      }).join("");

      /* ── la courbe de forme : taux de victoire glissant ──
         Le pourcentage global dit OÙ on en est ; la courbe dit COMMENT on
         y est arrivé. C'est la seule vue de la trajectoire du clan. */
      var chrono = liste.slice().reverse().map(function(b){ return b.result === 1 ? 1 : 0; });
      var courbe = "";
      if(chrono.length >= 8){
        /* fenêtre large : sur 80 batailles, 10 donne une dentelle, pas une
           trajectoire. n/5 borné à [8, 20] lisse sans effacer les inflexions. */
        var f = Math.max(8, Math.min(20, Math.round(chrono.length / 5))), pts = [];
        for(var i = f - 1; i < chrono.length; i++){
          var som = 0; for(var j = i - f + 1; j <= i; j++) som += chrono[j];
          pts.push(som / f);
        }
        var W = 300, H = 66, n = pts.length;
        var X = function(i){ return n > 1 ? (i / (n - 1)) * W : W / 2; };
        var Y = function(v){ return H - 4 - v * (H - 12); };
        var d = pts.map(function(v, i){ return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1); }).join("");
        courbe =
          '<figure class="vd-c"><div class="vd-ch">' +
            '<figcaption>Taux de victoire, lissé sur ' + f + ' batailles</figcaption>' +
            '<div class="vd-f">' + dix + '</div></div>' +
          '<div class="vd-cw" style="--y50:' + (Y(0.5) / H * 100).toFixed(2) + '%">' +
          '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' +
            'Courbe du taux de victoire glissant : de ' + Math.round(pts[0]*100) + ' % à ' +
            Math.round(pts[n-1]*100) + ' %.">' +
            '<line class="ref" x1="0" y1="' + Y(0.5).toFixed(1) + '" x2="' + W + '" y2="' + Y(0.5).toFixed(1) + '"/>' +
            '<path class="aire" d="' + d + 'L' + W + ' ' + H + 'L0 ' + H + 'Z"/>' +
            '<path class="trait" d="' + d + '"/>' +
          '</svg><span class="vd-c50">50 %</span></div></figure>';
      }

      hote.hidden = false;
      document.getElementById("viewClan").classList.add("cp-verdict");
      /* Le chiffre accompagne le titre ; la courbe a sa propre ligne,
         pleine largeur. Plus rien ne se dispute la place, et le
         pourcentage n'est plus écrit deux fois. */
      hote.innerHTML =
        '<div class="vd-haut">' +
          '<div class="vd-g"><h2 class="vd-t">' + titre + '</h2><p class="vd-p">' + ph + '</p></div>' +
          '<div class="vd-n"><b data-n="' + pct + '">' + pct + ' %</b><i>de victoires</i></div>' +
        '</div>' + courbe;

      /* le chiffre se compte */
      var n = hote.querySelector(".vd-n b");
      if(n && !doux && typeof animateNum === "function"){
        animateNum(n, pct, function(v){ return Math.round(v) + " %"; });
      }
    }catch(e){
      efface();   // jamais de bandeau à moitié écrit ; la carte « Santé du clan » reprend sa place
      console.warn("verdict non calculable :", e && e.message);
    }
  }

  /* ── révélation à l'approche ──────────────────────────────────── */
  var CIBLES = ["#viewClan .d2two", "#viewClan .d2sect", "#dashTop5",
                "#viewClan .d2card[style*='margin-top']", "#dashDesc"];
  function armeReveal(){
    var els = [];
    CIBLES.forEach(function(s){
      document.querySelectorAll(s).forEach(function(e){
        if(!e.classList.contains("rv")){ e.classList.add("rv"); els.push(e); }
      });
    });
    if(!els.length || doux || !("IntersectionObserver" in window)){
      els.forEach(function(e){ e.classList.add("vu"); }); return;
    }
    var io = new IntersectionObserver(function(ent){
      ent.forEach(function(x){
        if(x.isIntersecting){ x.target.classList.add("vu"); io.unobserve(x.target); }
      });
    }, { rootMargin: "0px 0px -12% 0px", threshold: 0.06 });
    els.forEach(function(e){ io.observe(e); });
    /* FILET : au bout de 3 s, tout est visible quoi qu'il arrive */
    setTimeout(function(){ els.forEach(function(e){ e.classList.add("vu"); }); }, 3000);
  }

  /* Le verdict doit suivre les filtres. On se greffe sur renderDashboard,
     ET on écoute directement la barre de filtres : selon la façon dont
     l'app re-rend, l'un ou l'autre peut ne pas passer. Deux chemins pour
     un seul résultat, et ecrisVerdict est idempotent. */
  if(typeof renderDashboard === "function"){
    var natif = renderDashboard;
    window.renderDashboard = function(){
      natif.apply(this, arguments);
      ecrisVerdict();
      armeReveal();          // le rendu peut arriver après le load
    };
  }
  var barre = document.getElementById("subbar");
  if(barre){
    barre.addEventListener("click",  function(){ setTimeout(ecrisVerdict, 30); });
    barre.addEventListener("change", function(){ setTimeout(ecrisVerdict, 30); });
  }
  ecrisVerdict();


  /* ── mise à feu ───────────────────────────────────────────────── */
  function demarre(){
    var h = document.documentElement;
    h.classList.add("rev");
    if(!doux){
      h.classList.add("cin");
      /* l'ouverture ne se joue QU'UNE FOIS : sans ça, chaque changement de
         filtre recrée les cartes et rejouerait toute la cascade */
      setTimeout(function(){ h.classList.remove("cin"); }, 2600);
    }
    armeReveal();
    /* FILET : si une animation reste bloquée, on retire la mise en scène */
    setTimeout(function(){
      document.querySelectorAll(".rv:not(.vu)").forEach(function(e){ e.classList.add("vu"); });
    }, 4000);
  }
  if(document.readyState === "complete") setTimeout(demarre, 260);
  else window.addEventListener("load", function(){ setTimeout(demarre, 260); });
})();


