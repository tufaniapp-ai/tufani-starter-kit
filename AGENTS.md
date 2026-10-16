<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

# Tufani — règles du projet

Plateforme de billets de bus au Mali : site voyageur, back-office des compagnies,
appli du personnel en gare (guichet, scan), espace d'administration Tufani.
La conception complète (écrans, sécurité, plan de développement) est dans le
dossier de conception et le canevas de maquettes, hors du dépôt.

- **Langue** : tout le texte visible est en français (le bambara viendra par fichiers de traduction). Montants en FCFA entiers, formatés par `src/domain/money.ts`.
- **Numéros** : un seul format en base, `+223XXXXXXXX` (`src/domain/phone.ts`). Le numéro est l'identité du voyageur et du personnel.
- **Logique métier** dans `src/domain/` (fonctions pures, testées). Les règles de sièges par tronçon sont dans `seats.ts` ; la base les applique aussi.
- **Cloisonnement** : chaque table métier a un `company_id` et une RLS ; les droits passent par `is_company_member`, `has_company_role` et `can_access_station`. Jamais de lecture de données d'une autre compagnie, même côté serveur.
- **Écritures sensibles** (annulation, remboursement, tarifs, compte de versement, équipe) : uniquement via des fonctions SQL `security definer` qui vérifient le rôle et appellent `log_action`. Le journal `audit_log` est en ajout seul.
- **Paiement et SMS** : uniquement via `src/server/payments.server.ts` et `src/server/sms.server.ts`. Les clés ne quittent jamais le serveur. Un billet n'est émis que sur vérification serveur du paiement, jamais sur un retour du navigateur.
- **Migrations** : fichiers numérotés dans `docs/migrations/`, appliqués à la main dans Lovable → Cloud → SQL editor. Ne jamais modifier une migration déjà appliquée : en écrire une nouvelle.
- **Hors ligne** : le guichet et le scan doivent continuer sans réseau ; toute fonctionnalité du personnel en gare est pensée avec une file de synchronisation.
- **Charte** : couleurs dans `src/styles.css` (vert `primary`, jaune `highlight`, `warning`), police Plus Jakarta Sans, cibles tactiles de 44 px minimum.
