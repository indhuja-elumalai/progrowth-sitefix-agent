// Page setup rules: the basics browsers, phones and screen readers need.
// Pure functions: facts from lib/head.js in, issues out.
//
// pageSetupIssues(head) -> no viewport tag (not mobile-friendly), no <html lang> (screen readers guess the language)

const issue = (type, severity, detail) => ({ type, severity, detail });

export function pageSetupIssues(head) {
    const out = [];
    if (!head.viewport) {
        out.push(issue("viewport-missing", "medium", "No <meta name=\"viewport\">: phones show the desktop layout zoomed out"));
    }
    if (!head.lang) {
        out.push(issue("lang-missing", "low", "No lang attribute on <html>: screen readers and translators have to guess the language"));
    }
    return out;
}
