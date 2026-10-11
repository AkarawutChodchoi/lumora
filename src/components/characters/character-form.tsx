"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Eye, Plus, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SelectField, TextArea, TextField } from "@/components/ui/field";
import { Avatar, Badge } from "@/components/ui/misc";
import { ImageUpload } from "@/components/ui/image-upload";
import { ChipPicker } from "@/components/ui/chip-picker";
import { MAX_CATEGORIES, MAX_TAGS } from "@/server/domain/enums";
import { CATEGORY_GROUPS, TAG_GROUPS } from "@/server/domain/taxonomy";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useT } from "@/i18n/client";

export interface CharacterFormValues {
  name: string;
  tagline: string;
  description: string;
  avatarUrl: string;
  personality: string;
  backstory: string;
  scenario: string;
  greeting: string;
  exampleDialogues: string;
  tags: string[];
  categories: string[];
  contentRating: string;
  visibility: string;
}

export const EMPTY_CHARACTER: CharacterFormValues = {
  name: "",
  tagline: "",
  description: "",
  avatarUrl: "",
  personality: "",
  backstory: "",
  scenario: "",
  greeting: "",
  exampleDialogues: "",
  tags: [],
  categories: [],
  contentRating: "general",
  visibility: "public",
};

const LIMITS = { name: 60, tagline: 120, description: 2000, personality: 4000, backstory: 6000, scenario: 3000, greeting: 2000, exampleDialogues: 4000 };

export function CharacterForm({
  mode,
  characterId,
  initial,
  canMature,
}: {
  mode: "create" | "edit";
  characterId?: string;
  initial: CharacterFormValues;
  canMature: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const draftKey = mode === "create" ? "lumora:character-draft" : null;
  const [v, setV] = useState<CharacterFormValues>(initial);
  const [tagInput, setTagInput] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [picker, setPicker] = useState<null | "categories" | "tags">(null);

  // Restore and autosave an unsent draft locally (create mode only).
  useEffect(() => {
    if (!draftKey) return;
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        const draft = { ...EMPTY_CHARACTER, ...JSON.parse(saved) };
        // Drafts saved before multi-category support had a single "category".
        if (!Array.isArray(draft.categories)) draft.categories = draft.category ? [draft.category] : [];
        setV(draft);
      }
    } catch {
      /* storage unavailable */
    }
  }, [draftKey]);
  useEffect(() => {
    if (!draftKey) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify(v));
      } catch {
        /* storage unavailable */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [v, draftKey]);

  const set = <K extends keyof CharacterFormValues>(k: K) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const count = (k: keyof typeof LIMITS) => ({ value: v[k].length, max: LIMITS[k] });

  function addTag(raw = tagInput) {
    const tag = raw.trim().toLowerCase().replace(/^#/, "").slice(0, 24);
    if (tag) setV((s) => (s.tags.includes(tag) || s.tags.length >= MAX_TAGS ? s : { ...s, tags: [...s.tags, tag] }));
    setTagInput("");
  }



  const tagLabel = (tag: string) => t.enums.tag[tag] ?? tag;

  function validate() {
    const e: Record<string, string> = {};
    if (!v.name.trim()) e.name = t.form.errName;
    if (!v.greeting.trim()) e.greeting = t.form.errGreeting;
    for (const [k, max] of Object.entries(LIMITS)) if ((v[k as keyof typeof LIMITS] as string).length > max) e[k] = t.form.errTooLong(max);
    if (v.avatarUrl && !/^(https:\/\/|\/api\/images\/)/.test(v.avatarUrl)) e.avatarUrl = t.form.errImage;
    if (v.categories.length === 0) e.categories = t.form.errCategory;
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) {
      toast.error(t.form.fixFields);
      return;
    }
    setBusy(true);
    try {
      const body = { ...v, avatarUrl: v.avatarUrl || null };
      const res =
        mode === "create"
          ? await api<{ id: string }>("/api/characters", { method: "POST", body })
          : await api<{ id: string }>(`/api/characters/${characterId}`, { method: "PUT", body });
      if (draftKey) {
        try {
          localStorage.removeItem(draftKey);
        } catch {
          /* ignore */
        }
      }
      toast.success(mode === "create" ? t.form.created : t.form.saved);
      router.push(`/characters/${res.id}`);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.details) setErrors(err.fieldErrors());
      toast.error(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]" noValidate>
      <div className="min-w-0 space-y-8">
        <fieldset className="space-y-4">
          <legend className="mb-2 font-display text-lg font-bold">{t.form.basics}</legend>
          <TextField label={t.form.name} value={v.name} onChange={set("name")} counter={count("name")} error={errors.name} required />
          <TextField label={t.form.tagline} value={v.tagline} onChange={set("tagline")} counter={count("tagline")} hint={t.form.taglineHint} error={errors.tagline} />
          <TextArea label={t.form.description} value={v.description} onChange={set("description")} counter={count("description")} hint={t.form.descriptionHint} error={errors.description} />
          <ImageUpload label={t.form.portrait} name={v.name} value={v.avatarUrl} onChange={(url) => setV((s) => ({ ...s, avatarUrl: url }))} error={errors.avatarUrl} />

          <div className="space-y-2" role="group" aria-labelledby="cat-label">
            <div className="flex items-baseline justify-between gap-3">
              <p id="cat-label" className="text-sm font-medium">
                {t.form.categories}
              </p>
              <span className={`text-xs tabular-nums ${v.categories.length ? "text-faint" : "text-danger"}`}>{t.form.categoriesCount(v.categories.length, MAX_CATEGORIES)}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {v.categories.map((c, idx) => (
                <span key={c} className="inline-flex items-center gap-1.5 rounded-full border border-accent bg-accent-soft py-1.5 pr-2 pl-3 text-sm">
                  {idx === 0 && <span className="rounded-full bg-accent px-1.5 text-[10px] font-semibold text-white">1</span>}
                  {t.enums.category[c] ?? c}
                  <button type="button" aria-label={t.form.removeTag(t.enums.category[c] ?? c)} onClick={() => setV((s) => ({ ...s, categories: s.categories.filter((x) => x !== c) }))} className="text-faint hover:text-fg">
                    <X className="size-3.5" />
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={() => setPicker("categories")}
                className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-strong px-3.5 py-1.5 text-sm text-muted hover:border-accent hover:text-fg"
              >
                <Plus className="size-4" /> {t.picker.chooseCategories}
              </button>
            </div>
            <p className={`text-xs ${errors.categories ? "text-danger" : "text-faint"}`} role={errors.categories ? "alert" : undefined}>
              {errors.categories ?? t.form.categoryHint}
            </p>
          </div>

          {mode === "create" && (
            <div className="space-y-2" role="radiogroup" aria-labelledby="vis-label">
              <p id="vis-label" className="text-sm font-medium">
                {t.form.visibility}
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                {(["public", "unlisted", "private"] as const).map((vis) => (
                  <button
                    key={vis}
                    type="button"
                    role="radio"
                    aria-checked={v.visibility === vis}
                    onClick={() => setV((s) => ({ ...s, visibility: vis }))}
                    className={`rounded-2xl border p-3 text-left transition-colors ${v.visibility === vis ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong"}`}
                  >
                    <span className="block text-sm font-semibold">{t.enums.visibility[vis]}</span>
                    <span className="mt-0.5 block text-xs text-muted">{t.form.visibilityHelp[vis]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label={t.form.rating}
              value={v.contentRating}
              onChange={set("contentRating")}
              options={[
                { value: "general", label: t.form.ratingGeneral },
                { value: "teen", label: t.form.ratingTeen },
                ...(canMature || v.contentRating === "mature" ? [{ value: "mature", label: t.form.ratingMature }] : []),
              ]}
              hint={canMature ? undefined : t.form.ratingHint}
              error={errors.contentRating}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="tag-input" className="text-sm font-medium">
              {t.form.tags} <span className="text-faint">({v.tags.length}/{MAX_TAGS})</span>
            </label>
            <button
              type="button"
              onClick={() => setPicker("tags")}
              disabled={v.tags.length >= MAX_TAGS}
              className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-strong px-3.5 py-1.5 text-sm text-muted hover:border-accent hover:text-fg disabled:opacity-40"
            >
              <Plus className="size-4" /> {t.picker.chooseTags}
            </button>
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2 p-2">
              {v.tags.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2.5 py-1 text-xs">
                  #{tagLabel(tag)}
                  <button type="button" aria-label={t.form.removeTag(tagLabel(tag))} onClick={() => setV((s) => ({ ...s, tags: s.tags.filter((x) => x !== tag) }))}>
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <input
                id="tag-input"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                onBlur={() => addTag()}
                placeholder={v.tags.length < MAX_TAGS ? t.form.customTag : ""}
                disabled={v.tags.length >= MAX_TAGS}
                className="min-w-32 flex-1 bg-transparent px-1 text-base placeholder:text-faint focus:outline-none sm:text-sm"
              />
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="mb-1 font-display text-lg font-bold">{t.form.story}</legend>
          <p className="text-xs text-faint">{t.form.storyHint}</p>
          <TextArea label={t.form.personality} value={v.personality} onChange={set("personality")} counter={count("personality")} placeholder={t.form.personalityPh} className="min-h-32" error={errors.personality} />
          <TextArea label={t.form.backstory} value={v.backstory} onChange={set("backstory")} counter={count("backstory")} placeholder={t.form.backstoryPh} className="min-h-32" error={errors.backstory} />
          <TextArea label={t.form.scenario} value={v.scenario} onChange={set("scenario")} counter={count("scenario")} placeholder={t.form.scenarioPh} error={errors.scenario} />
          <TextArea label={t.form.greeting} value={v.greeting} onChange={set("greeting")} counter={count("greeting")} placeholder={t.form.greetingPh} error={errors.greeting} required />
          <TextArea
            label={t.form.examples}
            value={v.exampleDialogues}
            onChange={set("exampleDialogues")}
            counter={count("exampleDialogues")}
            placeholder={t.form.examplesPh}
            error={errors.exampleDialogues}
          />
        </fieldset>

        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 flex items-center gap-2 rounded-2xl border border-line bg-surface/95 p-2 backdrop-blur md:bottom-4 sm:p-3">
          <Button type="button" variant="secondary" className="shrink-0 px-3 lg:hidden" onClick={() => setShowPreview((p) => !p)} aria-label={t.form.preview} aria-pressed={showPreview}>
            <Eye className="size-4" />
          </Button>
          <Button type="button" variant="ghost" onClick={() => router.back()} disabled={busy}>
            {t.common.cancel}
          </Button>
          <Button type="submit" className="ml-auto min-w-0 flex-1 sm:flex-none" loading={busy}>
            <Save className="size-4" /> {mode === "create" ? (v.visibility === "private" ? t.form.saveDraft : t.form.createAndShare) : t.form.saveChanges}
          </Button>
        </div>
      </div>

      <aside className={`${showPreview ? "block" : "hidden"} min-w-0 lg:block`} aria-label={t.form.preview}>
        <div className="sticky top-6 space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-faint">{t.form.preview}</p>
          <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="relative aspect-[4/5]">
              <Avatar name={v.name || "?"} src={/^(https:\/\/|\/api\/images\/)/.test(v.avatarUrl) ? v.avatarUrl : null} className="size-full text-6xl" rounded="rounded-none" />
              <div className="absolute inset-0 bg-gradient-to-t from-bg via-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-4">
                {v.contentRating !== "general" && <Badge tone="warn">{t.enums.rating[v.contentRating]}</Badge>}
                <p className="mt-1 font-display text-lg font-bold">{v.name || t.form.yourCharacter}</p>
                <p className="line-clamp-2 text-xs text-muted">{v.tagline || t.form.taglinePreview}</p>
              </div>
            </div>
          </div>
          <div className="rounded-2xl rounded-tl-md border border-line bg-surface-2 px-4 py-3 text-sm leading-relaxed whitespace-pre-line text-fg/90">
            {v.greeting || <span className="text-faint">{t.form.greetingPreview}</span>}
          </div>
          {mode === "create" && <p className="text-xs text-faint">{t.form.visibilityHelp[v.visibility as "public" | "unlisted" | "private"]}</p>}
        </div>
      </aside>
      <ChipPicker
        open={picker === "categories"}
        onClose={() => setPicker(null)}
        title={t.picker.chooseCategories}
        groups={CATEGORY_GROUPS}
        selected={v.categories}
        max={MAX_CATEGORIES}
        onChange={(categories) => setV((s) => ({ ...s, categories }))}
      />
      <ChipPicker
        open={picker === "tags"}
        onClose={() => setPicker(null)}
        title={t.picker.chooseTags}
        groups={TAG_GROUPS}
        selected={v.tags}
        max={MAX_TAGS}
        onChange={(tags) => setV((s) => ({ ...s, tags }))}
      />
    </form>
  );
}
