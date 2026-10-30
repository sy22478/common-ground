"use client";

import { useState } from "react";
import { EMPTY_FORM, familyFromForm, namesFor, type Family, type FamilyForm, type FormErrors } from "@/lib/family";

export interface Names {
  grandparent: string;
  visitor: string;
}

// Where the form is kept between visits to the page: this browser only. Nothing here is sent anywhere until "Plan
// our visit" is pressed, and the two names are never sent at all.
const KEPT = "common-ground.own-family.v1";
const LANGUAGES = ["Spanish", "Hindi", "Mandarin", "Cantonese", "Tagalog", "Vietnamese", "Korean", "Arabic", "Russian", "Ukrainian", "Polish", "Portuguese", "Italian", "French", "German", "Greek", "Japanese", "Punjabi", "Bengali", "Urdu", "Farsi", "English"];

interface Kept {
  form: FamilyForm;
  typed: Names;
}

const NOTHING_KEPT: Kept = { form: EMPTY_FORM, typed: { grandparent: "", visitor: "" } };

function readKept(): Kept {
  if (typeof window === "undefined") return NOTHING_KEPT;
  try {
    const kept = JSON.parse(window.localStorage.getItem(KEPT) ?? "null") as Partial<Kept> | null;
    if (kept?.form && kept.typed) {
      return { form: { ...EMPTY_FORM, ...kept.form }, typed: { grandparent: String(kept.typed.grandparent ?? ""), visitor: String(kept.typed.visitor ?? "") } };
    }
  } catch {
    // nothing kept, or storage is closed to us: start empty
  }
  return NOTHING_KEPT;
}

// Mounted only in the browser, after a click (app/page.tsx), so it may read the browser's storage as it starts.
export function FamilyFormView({ paused, busy, onPlan }: { paused: boolean; busy: boolean; onPlan: (family: Family, names: Names) => void }) {
  const [{ form, typed }, setKept] = useState<Kept>(readKept);
  const [errors, setErrors] = useState<FormErrors>({});

  function keep(nextForm: FamilyForm, nextTyped: Names) {
    setKept({ form: nextForm, typed: nextTyped });
    try {
      window.localStorage.setItem(KEPT, JSON.stringify({ form: nextForm, typed: nextTyped } satisfies Kept));
    } catch {
      // the form still works without being kept
    }
  }
  const set = (field: keyof FamilyForm, value: string) => keep({ ...form, [field]: value } as FamilyForm, typed);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = familyFromForm(form);
    setErrors(result.errors ?? {});
    if (result.family) onPlan(result.family, namesFor(form, typed));
  }

  // A field reached with Tab is brought wholly onto the screen. Left to itself the browser showed only the top 33 px
  // of the second text area at 375 by 667 (measured 2026-10-11). It does nothing when the field is already in view.
  const showWhole = (event: React.FocusEvent) => (event.target as HTMLElement).scrollIntoView({ block: "nearest" });

  const problem = (field: keyof FamilyForm) =>
    errors[field] ? (
      <p className="field-error" id={`${field}-error`} role="alert">
        {errors[field]}
      </p>
    ) : null;
  const described = (field: keyof FamilyForm) => (errors[field] ? { "aria-invalid": true, "aria-describedby": `${field}-error` } : {});

  return (
    <form className="card own" onSubmit={submit} onFocus={showWhole} noValidate>
      <fieldset>
        <legend>Your grandparent</legend>
        <label htmlFor="their-name">Their first name, or what you call them</label>
        <input id="their-name" value={typed.grandparent} maxLength={40} autoComplete="off" onChange={(e) => keep(form, { ...typed, grandparent: e.target.value })} />

        <div className="choice" role="radiogroup" aria-label="Grandmother or grandfather">
          {(["grandmother", "grandfather", ""] as const).map((value) => (
            <label key={value || "unsaid"}>
              <input type="radio" name="relation" checked={form.relation === value} onChange={() => set("relation", value)} /> {value ? value[0]!.toUpperCase() + value.slice(1) : "Rather not say"}
            </label>
          ))}
        </div>

        <label htmlFor="birth-year">The year they were born</label>
        <input id="birth-year" inputMode="numeric" value={form.birthYear} maxLength={4} placeholder="1941" onChange={(e) => set("birthYear", e.target.value)} {...described("birthYear")} />
        {problem("birthYear")}

        <label htmlFor="language">The language they are most at home in</label>
        <input id="language" list="languages" value={form.language} maxLength={30} placeholder="Spanish" onChange={(e) => set("language", e.target.value)} {...described("language")} />
        <datalist id="languages">
          {LANGUAGES.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
        {problem("language")}

        <label htmlFor="city">The city they live in now (optional)</label>
        <input id="city" value={form.city} maxLength={80} placeholder="San Antonio, Texas" onChange={(e) => set("city", e.target.value)} {...described("city")} />
        {problem("city")}

        <label htmlFor="their-favorites">What they love: singers, films, shows, dishes, habits. One per line, up to eight</label>
        <textarea id="their-favorites" rows={4} value={form.theirFavorites} placeholder={"Pedro Infante\nRoman Holiday\nmaking tamales at Christmas"} onChange={(e) => set("theirFavorites", e.target.value)} {...described("theirFavorites")} />
        {problem("theirFavorites")}
      </fieldset>

      <fieldset>
        <legend>You</legend>
        <label htmlFor="your-name">Your first name</label>
        <input id="your-name" value={typed.visitor} maxLength={40} autoComplete="off" onChange={(e) => keep(form, { ...typed, visitor: e.target.value })} />

        <label htmlFor="your-favorites">What you love. One per line, up to eight</label>
        <textarea id="your-favorites" rows={3} value={form.yourFavorites} placeholder={"Bad Bunny\nSpirited Away\nbaking"} onChange={(e) => set("yourFavorites", e.target.value)} {...described("yourFavorites")} />
        {problem("yourFavorites")}
      </fieldset>

      <p className="sources">The two names stay on this device and are never sent. Tastes only, please: no phone numbers, addresses or other personal details.</p>
      {paused && <p className="lead">Live planning is paused right now, so this form cannot make a plan yet. What you type is kept on this device for when it can.</p>}
      <button type="submit" disabled={busy || paused}>
        {busy ? "Planning..." : "Plan our visit"}
      </button>
    </form>
  );
}
