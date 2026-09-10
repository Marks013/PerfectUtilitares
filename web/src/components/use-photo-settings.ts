"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import {
  PHOTO_DEFAULTS,
  photoSettingsSchema,
  type PhotoSettings,
  type PhotoSettingsInput,
} from "@/lib/photos/schema";
import {
  getPhotoSettingsStorageKey,
  PHOTO_SETTINGS_STORAGE_KEY,
} from "./photo-3x4-workspace-model";

export function usePhotoSettings(userId: string) {
  const restoredSettings = useRef(false);
  const photoSettingsStorageKey = getPhotoSettingsStorageKey(userId);
  const form = useForm<PhotoSettingsInput, unknown, PhotoSettings>({
    resolver: zodResolver(photoSettingsSchema),
    defaultValues: {
      ...PHOTO_DEFAULTS,
      format: "jpeg",
      replaceOriginal: true,
      convertToJpg: false,
    },
  });

  useEffect(() => {
    try {
      const rawSettings =
        window.localStorage.getItem(photoSettingsStorageKey) ??
        window.localStorage.getItem(PHOTO_SETTINGS_STORAGE_KEY);
      if (rawSettings) {
        const parsed = photoSettingsSchema.safeParse(JSON.parse(rawSettings));
        if (parsed.success) {
          form.reset({
            ...parsed.data,
            width: PHOTO_DEFAULTS.width,
            height: PHOTO_DEFAULTS.height,
            format:
              parsed.data.format === "original" ? "jpeg" : parsed.data.format,
            replaceOriginal: true,
            convertToJpg: false,
          });
        }
      }
    } catch {
      window.localStorage.removeItem(photoSettingsStorageKey);
    } finally {
      restoredSettings.current = true;
    }
  }, [form, photoSettingsStorageKey]);

  useEffect(() => {
    const subscription = form.watch((values) => {
      if (!restoredSettings.current) {
        return;
      }

      const parsed = photoSettingsSchema.safeParse({
        ...values,
        width: PHOTO_DEFAULTS.width,
        height: PHOTO_DEFAULTS.height,
        replaceOriginal: true,
        convertToJpg: false,
      });
      if (parsed.success) {
        window.localStorage.setItem(
          photoSettingsStorageKey,
          JSON.stringify(parsed.data),
        );
      }
    });

    return () => subscription.unsubscribe();
  }, [form, photoSettingsStorageKey]);

  return form;
}
