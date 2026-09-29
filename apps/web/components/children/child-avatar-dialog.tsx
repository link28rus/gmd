'use client';

import { useRef, useState, type ChangeEvent, type ReactElement } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ChildAvatar } from '@/components/avatar/child-avatar';
import { ApiError } from '@/lib/api/client';
import type { Child } from '@/lib/api/children';
import { AVATAR_PRESETS, parseAvatarKey, presetSrc } from '@/lib/avatar/presets';
import { useRemoveChildAvatar, useSetChildAvatar } from '@/lib/hooks/use-child-avatar';

interface Props {
  child: Child;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

// Сервер принимает до 300 КБ после декодирования и сам не перекодирует —
// сжимаем здесь. 512×512 JPEG q=0.85 обычно 40–120 КБ.
const PHOTO_SIZE = 512;
const MAX_PHOTO_BYTES = 300 * 1024;
const JPEG_QUALITIES = [0.85, 0.7, 0.55];

export function ChildAvatarDialog({ child, open, onOpenChange }: Props): ReactElement {
  const setAvatar = useSetChildAvatar();
  const removeAvatar = useRemoveChildAvatar();
  const fileRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);

  const current = parseAvatarKey(child.avatarKey);
  const busy = processing || setAvatar.isPending || removeAvatar.isPending;

  const onPreset = async (id: string): Promise<void> => {
    if (busy) return;
    try {
      await setAvatar.mutateAsync({ id: child.id, body: { preset: id } });
      toast.success('Аватар обновлён');
      onOpenChange(false);
    } catch (e) {
      toast.error(avatarErrorMessage(e));
    }
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    // Сбрасываем value, чтобы повторный выбор того же файла снова вызвал onChange.
    e.target.value = '';
    if (!file || busy) return;
    setProcessing(true);
    try {
      const blob = await squareJpeg(file);
      const base64 = await blobToBase64(blob);
      await setAvatar.mutateAsync({
        id: child.id,
        body: { photo: { mime: 'image/jpeg', base64 } },
        blob,
      });
      toast.success('Фото сохранено');
      onOpenChange(false);
    } catch (err) {
      toast.error(avatarErrorMessage(err));
    } finally {
      setProcessing(false);
    }
  };

  const onRemove = async (): Promise<void> => {
    if (busy) return;
    try {
      await removeAvatar.mutateAsync(child.id);
      toast.success('Фото убрано');
      onOpenChange(false);
    } catch (e) {
      toast.error(avatarErrorMessage(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Фото профиля</DialogTitle>
          <DialogDescription>
            Выберите картинку или загрузите фото — {child.name} будет так выглядеть на карте и в
            списке.
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-center">
          <ChildAvatar name={child.name} avatarKey={child.avatarKey} childId={child.id} size={88} />
        </div>

        <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
          {AVATAR_PRESETS.map((p) => {
            const selected = current.kind === 'preset' && current.id === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => void onPreset(p.id)}
                disabled={busy}
                aria-label={p.label}
                aria-pressed={selected}
                title={p.label}
                className={`rounded-full p-0.5 transition disabled:cursor-wait disabled:opacity-60 ${
                  selected
                    ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                    : 'hover:scale-105'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={presetSrc(p.id)} alt="" className="aspect-square w-full rounded-full" />
              </button>
            );
          })}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void onFile(e)}
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
          <Button type="button" onClick={() => fileRef.current?.click()} disabled={busy}>
            <ImagePlus className="mr-2 h-4 w-4" />
            {processing ? 'Загружаем…' : 'Загрузить фото'}
          </Button>
          {child.avatarKey !== null && (
            <Button type="button" variant="outline" onClick={() => void onRemove()} disabled={busy}>
              <Trash2 className="mr-2 h-4 w-4" />
              Убрать фото
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

class ImageReadError extends Error {}

function avatarErrorMessage(e: unknown): string {
  if (e instanceof ImageReadError) return e.message;
  if (e instanceof ApiError) {
    if (e.code === 'avatar_too_large' || e.status === 413) return 'Фото слишком большое';
    if (e.code === 'invalid_avatar') return 'Файл не похож на изображение';
    if (e.status === 404) return 'Ребёнок не найден';
  }
  return 'Не удалось сохранить фото. Попробуйте ещё раз';
}

async function loadImage(
  file: File,
): Promise<CanvasImageSource & { width: number; height: number }> {
  if (!file.type.startsWith('image/')) {
    throw new ImageReadError('Выберите файл изображения');
  }
  try {
    // createImageBitmap учитывает EXIF-поворот (фото с телефона не ложатся набок).
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Fallback для браузеров без опций createImageBitmap.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } catch {
      throw new ImageReadError('Не удалось прочитать изображение. Выберите JPEG или PNG');
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** Квадратная обрезка по центру → до 512×512 JPEG, не больше лимита сервера. */
async function squareJpeg(file: File): Promise<Blob> {
  const img = await loadImage(file);
  const side = Math.min(img.width, img.height);
  if (!side) throw new ImageReadError('Не удалось прочитать изображение');
  const out = Math.min(PHOTO_SIZE, side);
  const canvas = document.createElement('canvas');
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageReadError('Браузер не поддерживает обработку изображений');
  // Прозрачный PNG в JPEG иначе станет чёрным.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out, out);
  ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, out, out);
  if ('close' in img && typeof img.close === 'function') img.close();

  for (const q of JPEG_QUALITIES) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', q),
    );
    if (!blob) break;
    if (blob.size <= MAX_PHOTO_BYTES) return blob;
  }
  throw new ImageReadError('Не удалось сжать фото. Выберите другое изображение');
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result);
      resolve(s.slice(s.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new ImageReadError('Не удалось прочитать изображение'));
    reader.readAsDataURL(blob);
  });
}
