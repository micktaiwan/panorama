// User context for AI prompts
// Centralized location for user-specific information injected into system prompts

export const USER_CONTEXT = {
  identity: {
    name: "Mickael Faivre-Maçon",
    role: "CTO",
    company: "lempire",
    location: "Paris (full-remote)"
  },
  company: {
    name: "lempire",
    products: {
      lemlist: "Sales Automation Platform (features: lemwarm email/domain warm-up, lemcal calendly-like)",
      claap: "AI assisted meeting recording"
    },
    revenue: "45M€",
    techTeamSize: 60
  },
  techStack: {
    primary: "JavaScript (Node.js / React)",
    framework: "Meteor"
  }
};

/**
 * Build user context block for injection into AI prompts
 * Returns a formatted string with user identity, company, and tech stack info
 *
 * @returns {string} Formatted user context block (~50 tokens)
 */
export function buildUserContextBlock() {
  const productsDesc = Object.entries(USER_CONTEXT.company.products)
    .map(([name, desc]) => `${name} (${desc})`)
    .join(', ');

  return [
    "CONTEXTE UTILISATEUR:",
    `Tu assistes ${USER_CONTEXT.identity.name}, ${USER_CONTEXT.identity.role} de ${USER_CONTEXT.company.name} (${USER_CONTEXT.identity.location}).`,
    `Produits: ${productsDesc}.`,
    `${USER_CONTEXT.company.revenue} de CA annuel, ${USER_CONTEXT.company.techTeamSize} personnes en tech.`,
    `Stack technique: ${USER_CONTEXT.techStack.primary}, ${USER_CONTEXT.techStack.framework}.`,
    ""
  ].join('\n');
}
