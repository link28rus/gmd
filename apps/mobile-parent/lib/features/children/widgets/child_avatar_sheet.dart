import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/api/api_exception.dart';
import '../child_models.dart';
import '../children_providers.dart';
import '../children_repository.dart';
import 'child_avatar.dart';

/// Лимит фото — как на backend (`CHILD_AVATAR_MAX_BYTES`, 300 КБ).
const int kChildAvatarMaxBytes = 300 * 1024;

/// Bottom sheet «Фото профиля»: стандартные аватары, фото из галереи/камеры,
/// «Убрать фото». Успех — sheet закрывается, список детей перечитывается,
/// снизу snackbar. Ошибки показываются внутри sheet'а (snackbar страницы
/// оказался бы под модальным sheet'ом), чтобы можно было сразу выбрать другое.
Future<void> showChildAvatarSheet(BuildContext context, Child child) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _ChildAvatarSheet(child: child),
  );
}

/// MIME по сигнатуре файла (backend проверяет её же): JPEG `FF D8 FF`,
/// PNG `89 50 4E 47`, WebP `RIFF....WEBP`. Иное (HEIC, GIF…) → null.
@visibleForTesting
String? detectAvatarMime(Uint8List b) {
  if (b.length >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) {
    return 'image/jpeg';
  }
  if (b.length >= 4 &&
      b[0] == 0x89 &&
      b[1] == 0x50 &&
      b[2] == 0x4E &&
      b[3] == 0x47) {
    return 'image/png';
  }
  if (b.length >= 12 &&
      String.fromCharCodes(b.sublist(0, 4)) == 'RIFF' &&
      String.fromCharCodes(b.sublist(8, 12)) == 'WEBP') {
    return 'image/webp';
  }
  return null;
}

class _ChildAvatarSheet extends ConsumerStatefulWidget {
  const _ChildAvatarSheet({required this.child});

  final Child child;

  @override
  ConsumerState<_ChildAvatarSheet> createState() => _ChildAvatarSheetState();
}

class _ChildAvatarSheetState extends ConsumerState<_ChildAvatarSheet> {
  bool _busy = false;
  String? _error;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final child = widget.child;
    final selectedPreset = ChildAvatarKey.parse(child.avatarKey)?.presetId;

    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                ChildAvatar(
                  name: child.name,
                  childId: child.id,
                  avatarKey: child.avatarKey,
                  size: 56,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Фото профиля',
                        style: theme.textTheme.titleMedium
                            ?.copyWith(fontWeight: FontWeight.w600),
                      ),
                      Text(
                        child.name,
                        style: theme.textTheme.bodyMedium
                            ?.copyWith(color: scheme.onSurfaceVariant),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Text('Стандартные', style: theme.textTheme.labelLarge),
            const SizedBox(height: 8),
            GridView.count(
              crossAxisCount: 4,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 12,
              crossAxisSpacing: 12,
              children: [
                for (final id in ChildAvatarKey.presets)
                  _PresetTile(
                    id: id,
                    selected: id == selectedPreset,
                    onTap: _busy ? null : () => _onPreset(id),
                  ),
              ],
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed:
                        _busy ? null : () => _onPick(ImageSource.gallery),
                    icon: const Icon(Icons.photo_library_outlined),
                    label: const Text('Галерея'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _busy ? null : () => _onPick(ImageSource.camera),
                    icon: const Icon(Icons.photo_camera_outlined),
                    label: const Text('Камера'),
                  ),
                ),
              ],
            ),
            if (child.avatarKey != null) ...[
              const SizedBox(height: 8),
              TextButton.icon(
                onPressed: _busy ? null : _onRemove,
                style: TextButton.styleFrom(foregroundColor: scheme.error),
                icon: const Icon(Icons.delete_outline),
                label: const Text('Убрать фото'),
              ),
            ],
            if (_busy) ...[
              const SizedBox(height: 12),
              const LinearProgressIndicator(),
            ],
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(
                _error!,
                style: theme.textTheme.bodyMedium?.copyWith(color: scheme.error),
                textAlign: TextAlign.center,
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _onPreset(String id) async {
    if (ChildAvatarKey.parse(widget.child.avatarKey)?.presetId == id) {
      Navigator.of(context).pop();
      return;
    }
    await _run(
      (repo) => repo.setAvatarPreset(widget.child.id, id),
      success: 'Аватар обновлён',
    );
  }

  Future<void> _onRemove() async {
    await _run(
      (repo) => repo.removeAvatar(widget.child.id),
      success: 'Фото профиля убрано',
    );
  }

  Future<void> _onPick(ImageSource source) async {
    setState(() => _error = null);
    final XFile? file;
    try {
      // Сжатие на клиенте (спека): сервер не перекодирует, только проверяет
      // сигнатуру и лимит 300 КБ.
      file = await ImagePicker().pickImage(
        source: source,
        maxWidth: 512,
        maxHeight: 512,
        imageQuality: 85,
      );
    } on PlatformException catch (e) {
      if (!mounted) return;
      setState(() => _error = source == ImageSource.camera
          ? 'Не удалось открыть камеру (${e.code})'
          : 'Не удалось открыть галерею (${e.code})');
      return;
    }
    if (file == null || !mounted) return; // пользователь отменил выбор

    final bytes = await file.readAsBytes();
    if (!mounted) return;
    final mime = detectAvatarMime(bytes);
    if (mime == null) {
      setState(() => _error = 'Этот формат не подходит — нужна фотография JPEG, PNG или WebP');
      return;
    }
    if (bytes.length > kChildAvatarMaxBytes) {
      setState(() => _error =
          'Фото слишком большое (${(bytes.length / 1024).round()} КБ, можно до 300 КБ). '
          'Выберите другое.');
      return;
    }
    await _run(
      (repo) => repo.uploadAvatarPhoto(widget.child.id, bytes, mime),
      success: 'Фото профиля обновлено',
    );
  }

  Future<void> _run(
    Future<Object?> Function(ChildrenRepository repo) action, {
    required String success,
  }) async {
    // Захватываем до await: после pop context sheet'а уже недействителен.
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action(ref.read(childrenRepositoryProvider));
      // childrenListProvider — источник истины для avatarKey (главная,
      // карточка статуса и маркер читают его оттуда).
      ref.invalidate(childrenListProvider);
      navigator.pop();
      messenger.showSnackBar(SnackBar(content: Text(success)));
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = _errorText(e);
      });
    }
  }

  static String _errorText(Object e) {
    ApiException? api;
    if (e is ApiException) api = e;
    if (e is DioException) {
      final inner = e.error;
      if (inner is ApiException) api = inner;
      if (api == null) {
        final status = e.response?.statusCode;
        if (status != null) return 'Не удалось сохранить (код $status)';
        return 'Нет связи с сервером. Попробуйте ещё раз.';
      }
    }
    if (api != null) {
      switch (api.code) {
        case 'avatar_too_large':
          return 'Фото слишком большое (можно до 300 КБ). Выберите другое.';
        case 'invalid_avatar':
          return 'Файл не похож на фотографию JPEG, PNG или WebP.';
        case 'child_not_found':
          return 'Ребёнок не найден.';
      }
      if (api.status == 413) {
        return 'Фото слишком большое (можно до 300 КБ). Выберите другое.';
      }
      return api.message ?? 'Не удалось сохранить (код ${api.status})';
    }
    return 'Не удалось сохранить: $e';
  }
}

/// Подписи для TalkBack/VoiceOver.
const _presetNames = <String, String>{
  'fox': 'Лисёнок',
  'bear': 'Медвежонок',
  'panda': 'Панда',
  'cat': 'Котёнок',
  'bunny': 'Зайчик',
  'owl': 'Совёнок',
  'penguin': 'Пингвин',
  'frog': 'Лягушонок',
  'lion': 'Львёнок',
  'koala': 'Коала',
  'puppy': 'Щенок',
  'tiger': 'Тигрёнок',
};

class _PresetTile extends StatelessWidget {
  const _PresetTile({required this.id, required this.selected, this.onTap});

  final String id;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Semantics(
      button: true,
      selected: selected,
      label: _presetNames[id] ?? id,
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(3),
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(
              color: selected ? scheme.primary : Colors.transparent,
              width: 3,
            ),
          ),
          child: ClipOval(
            child: SvgPicture.asset(
              ChildAvatarKey.presetAsset(id),
              fit: BoxFit.cover,
            ),
          ),
        ),
      ),
    );
  }
}
