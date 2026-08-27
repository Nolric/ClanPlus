/* Clan Plus — le cadre de la page « Ma progression », anglais → français.
   Le cadre de cette page est écrit en anglais dans la source, comme les
   pages publiques : c'est cette version que Google indexe. Le contenu de
   l'application, lui, est écrit en français et traduit dans l'autre sens
   par index.en.js. Les deux dictionnaires ne se croisent jamais : le
   moteur n'en charge qu'un, selon la langue demandée. */
window.t = window.t || function (s) { return s; };
window.CP_FR = Object.assign(window.CP_FR || {}, {
  "Back to Clan Plus": "Retour à Clan Plus",
  "My progress": "Ma progression",
  "Player": "Joueur",
  "Loading…": "Chargement…",
  "Fetching your clan's recorded battles.": "Récupération des batailles enregistrées de ton clan.",
  "Sign in to see your progress": "Connecte-toi pour voir ta progression",
  "This page reads the Stronghold battles recorded for your clan. It needs your Wargaming sign-in.": "Cette page lit les batailles Bastion enregistrées pour ton clan. Elle a besoin de ta connexion Wargaming.",
  "Go to Clan Plus": "Aller sur Clan Plus"
});
