import { useQuery } from "@tanstack/react-query";
import { api } from "./api/client";

// B8: minimal i18n for the app chrome. Scope: sidebar navigation labels,
// section headers, account menu, top bar, notification bell, the Preferences
// page title/tabs and common dialog buttons. Full app translation is out of
// scope; untranslated strings fall back to English.

export const SUPPORTED_LANGUAGES = ["en", "es", "fr", "de"] as const;
export type Lang = (typeof SUPPORTED_LANGUAGES)[number];

type Dict = Record<string, string>;

const en: Dict = {
  "nav.timesheet": "Timesheet",
  "nav.tracker": "Time Tracker",
  "nav.calendar": "Calendar",
  "nav.dashboard": "Dashboard",
  "nav.reports": "Reports",
  "nav.projects": "Projects",
  "nav.team": "Team",
  "nav.clients": "Clients",
  "section.analyze": "Analyze",
  "section.manage": "Manage",
  "account.profile": "My profile",
  "account.preferences": "Preferences",
  "account.logout": "Log out",
  "prefs.title": "Preferences",
  "prefs.general": "General",
  "prefs.emailNotifications": "Email Notifications",
  "prefs.pumbleNotifications": "Pumble Notifications",
  "prefs.advanced": "Advanced",
  "notifications.title": "Notifications",
  "notifications.pendingInvitations": "Pending invitations",
  "notifications.invitePending": "Invitation pending",
  "notifications.recent": "Recent notifications",
  "notifications.empty": "No notifications",
  "common.cancel": "Cancel",
  "common.confirm": "Confirm",
  "common.delete": "Delete",
  "common.save": "Save",
};

const es: Dict = {
  "nav.timesheet": "Parte de horas",
  "nav.tracker": "Control de tiempo",
  "nav.calendar": "Calendario",
  "nav.dashboard": "Panel",
  "nav.reports": "Informes",
  "nav.projects": "Proyectos",
  "nav.team": "Equipo",
  "nav.clients": "Clientes",
  "section.analyze": "Analizar",
  "section.manage": "Gestionar",
  "account.profile": "Mi perfil",
  "account.preferences": "Preferencias",
  "account.logout": "Cerrar sesión",
  "prefs.title": "Preferencias",
  "prefs.general": "General",
  "prefs.emailNotifications": "Notificaciones por correo",
  "prefs.pumbleNotifications": "Notificaciones de Pumble",
  "prefs.advanced": "Avanzado",
  "notifications.title": "Notificaciones",
  "notifications.pendingInvitations": "Invitaciones pendientes",
  "notifications.invitePending": "Invitación pendiente",
  "notifications.recent": "Notificaciones recientes",
  "notifications.empty": "Sin notificaciones",
  "common.cancel": "Cancelar",
  "common.confirm": "Confirmar",
  "common.delete": "Eliminar",
  "common.save": "Guardar",
};

const fr: Dict = {
  "nav.timesheet": "Feuille de temps",
  "nav.tracker": "Suivi du temps",
  "nav.calendar": "Calendrier",
  "nav.dashboard": "Tableau de bord",
  "nav.reports": "Rapports",
  "nav.projects": "Projets",
  "nav.team": "Équipe",
  "nav.clients": "Clients",
  "section.analyze": "Analyser",
  "section.manage": "Gérer",
  "account.profile": "Mon profil",
  "account.preferences": "Préférences",
  "account.logout": "Se déconnecter",
  "prefs.title": "Préférences",
  "prefs.general": "Général",
  "prefs.emailNotifications": "Notifications par e-mail",
  "prefs.pumbleNotifications": "Notifications Pumble",
  "prefs.advanced": "Avancé",
  "notifications.title": "Notifications",
  "notifications.pendingInvitations": "Invitations en attente",
  "notifications.invitePending": "Invitation en attente",
  "notifications.recent": "Notifications récentes",
  "notifications.empty": "Aucune notification",
  "common.cancel": "Annuler",
  "common.confirm": "Confirmer",
  "common.delete": "Supprimer",
  "common.save": "Enregistrer",
};

const de: Dict = {
  "nav.timesheet": "Stundenzettel",
  "nav.tracker": "Zeiterfassung",
  "nav.calendar": "Kalender",
  "nav.dashboard": "Dashboard",
  "nav.reports": "Berichte",
  "nav.projects": "Projekte",
  "nav.team": "Team",
  "nav.clients": "Kunden",
  "section.analyze": "Analysieren",
  "section.manage": "Verwalten",
  "account.profile": "Mein Profil",
  "account.preferences": "Einstellungen",
  "account.logout": "Abmelden",
  "prefs.title": "Einstellungen",
  "prefs.general": "Allgemein",
  "prefs.emailNotifications": "E-Mail-Benachrichtigungen",
  "prefs.pumbleNotifications": "Pumble-Benachrichtigungen",
  "prefs.advanced": "Erweitert",
  "notifications.title": "Benachrichtigungen",
  "notifications.pendingInvitations": "Ausstehende Einladungen",
  "notifications.invitePending": "Einladung ausstehend",
  "notifications.recent": "Neueste Benachrichtigungen",
  "notifications.empty": "Keine Benachrichtigungen",
  "common.cancel": "Abbrechen",
  "common.confirm": "Bestätigen",
  "common.delete": "Löschen",
  "common.save": "Speichern",
};

const dictionaries: Record<Lang, Dict> = { en, es, fr, de };

export function translate(lang: Lang, key: string): string {
  return dictionaries[lang]?.[key] ?? en[key] ?? key;
}

/**
 * Returns the current user's language (from the cached /users/me profile) and
 * a `t` function. Components re-render automatically when the language
 * preference changes because GeneralPreferences invalidates "user-profile".
 */
export function useI18n() {
  const { data } = useQuery({
    queryKey: ["user-profile"],
    queryFn: async () => (await api.get("/users/me")).data,
  });
  const lang: Lang = SUPPORTED_LANGUAGES.includes(data?.language)
    ? (data.language as Lang)
    : "en";
  return { lang, t: (key: string) => translate(lang, key) };
}
