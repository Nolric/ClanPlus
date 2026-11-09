/* Le cadre commun des pages publiques (voir cadre.css).
   Une seule chose à faire : quand ce navigateur a déjà une session, le
   bouton « Se connecter » de la barre devient « Ouvrir Clan Plus » — il
   mène au même endroit, mais il ne ment plus.
   Sans script, le bouton reste « Se connecter » et fonctionne quand même. */
(function () {
  var a = document.getElementById("cpcSignin");
  if (!a) return;
  var s = null;
  try { s = localStorage.getItem("cp_session"); } catch (e) { }
  if (s) a.textContent = (window.t || String)("Open Clan Plus");
})();
