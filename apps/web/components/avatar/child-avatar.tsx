'use client';

import type { CSSProperties, ReactElement } from 'react';
import { avatarColor, avatarInitial } from '@/lib/color/avatar-color';
import { parseAvatarKey, presetSrc } from '@/lib/avatar/presets';
import { useChildAvatarUrl } from '@/lib/hooks/use-child-avatar';

interface Props {
  name: string;
  avatarKey?: string | null;
  /** Нужен только для фото (грузится по id ребёнка). */
  childId?: string;
  /** Диаметр в px. */
  size?: number;
  className?: string;
}

/**
 * Аватар ребёнка: буква имени на цветном фоне, стандартный зверёк или фото.
 * Фото грузится через react-query — пока грузится или при ошибке видна буква.
 */
export function ChildAvatar({
  name,
  avatarKey,
  childId,
  size = 36,
  className,
}: Props): ReactElement {
  const parsed = parseAvatarKey(avatarKey);
  if (parsed.kind === 'preset') {
    return <AvatarImage src={presetSrc(parsed.id)} size={size} className={className} />;
  }
  if (parsed.kind === 'photo' && childId) {
    return (
      <PhotoAvatar
        name={name}
        avatarKey={avatarKey}
        childId={childId}
        size={size}
        className={className}
      />
    );
  }
  return <LetterAvatar name={name} size={size} className={className} />;
}

function PhotoAvatar({
  name,
  avatarKey,
  childId,
  size,
  className,
}: Required<Pick<Props, 'name' | 'childId' | 'size'>> &
  Pick<Props, 'avatarKey' | 'className'>): ReactElement {
  const url = useChildAvatarUrl(childId, avatarKey);
  if (!url) return <LetterAvatar name={name} size={size} className={className} />;
  return <AvatarImage src={url} size={size} className={className} />;
}

function AvatarImage({
  src,
  size,
  className,
}: {
  src: string;
  size: number;
  className?: string;
}): ReactElement {
  return (
    // Фото — blob: URL, next/image для него не подходит; пресеты — маленькие SVG.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={`shrink-0 rounded-full object-cover ${className ?? ''}`}
      style={{ width: size, height: size }}
    />
  );
}

function LetterAvatar({
  name,
  size,
  className,
}: {
  name: string;
  size: number;
  className?: string;
}): ReactElement {
  const style: CSSProperties = {
    width: size,
    height: size,
    backgroundColor: avatarColor(name),
    fontSize: Math.round(size * 0.4),
  };
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${className ?? ''}`}
      style={style}
    >
      <span>{avatarInitial(name)}</span>
    </div>
  );
}
