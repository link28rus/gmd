import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../../core/providers.dart';
import '../children/child_models.dart';
import '../children/children_providers.dart';
import 'widgets/where_am_i.dart';
import 'widgets/zone_widgets.dart';
import 'zone_format.dart';
import 'zone_map_view.dart';
import 'zone_models.dart';
import 'zones_providers.dart';

/// Редактор зоны (спека 3.1): `/home/zones/new?lat=&lon=&zoom=&childId=` и
/// `/home/zones/:id/edit`. Центр зоны = центр карты (перетаскиваемого маркера
/// у flutter_map нет) — пин нарисован поверх карты.
class ZoneEditorScreen extends ConsumerWidget {
  const ZoneEditorScreen({
    super.key,
    this.zoneId,
    this.initialLat,
    this.initialLon,
    this.initialZoom,
    this.initialChildId,
  });

  /// null — новая зона.
  final String? zoneId;
  final double? initialLat;
  final double? initialLon;
  final double? initialZoom;

  /// Зона «от ребёнка» — его отмечаем, если снять «Все дети».
  final String? initialChildId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isNew = zoneId == null;
    final childrenAsync = ref.watch(childrenListProvider);
    final zonesAsync = isNew ? null : ref.watch(zonesListProvider);
    final tzAsync = ref.watch(deviceTimeZoneProvider);

    Widget scaffold(Widget body) => Scaffold(
          appBar: AppBar(title: Text(isNew ? 'Новая зона' : 'Изменить зону')),
          body: body,
        );

    // Дети нужны для назначений (новая зона по умолчанию — все), пояс — для
    // расписания; оба ответа обычно мгновенные (кэш / канал).
    if ((!childrenAsync.hasValue && !childrenAsync.hasError) || tzAsync.isLoading) {
      return scaffold(const Center(child: CircularProgressIndicator()));
    }
    final kids = childrenAsync.valueOrNull ?? const <Child>[];
    final tz = tzAsync.valueOrNull;

    Zone? zone;
    if (!isNew) {
      if (zonesAsync!.hasError && !zonesAsync.hasValue) {
        return scaffold(_Message(
          text: zoneErrorMessage(zonesAsync.error!, ZoneAction.load),
          onRetry: () => ref.invalidate(zonesListProvider),
        ));
      }
      if (!zonesAsync.hasValue) {
        return scaffold(const Center(child: CircularProgressIndicator()));
      }
      zone = zonesAsync.value!.where((z) => z.id == zoneId).firstOrNull;
      if (zone == null) {
        return scaffold(const _Message(text: 'Зона не найдена — возможно, её уже удалили.'));
      }
    }

    return _ZoneEditorForm(
      key: ValueKey(zone?.id ?? 'new'),
      zone: zone,
      kids: kids,
      deviceTimeZone: tz,
      initialCenter: (initialLat != null && initialLon != null)
          ? LatLng(initialLat!, initialLon!)
          : null,
      initialZoom: initialZoom,
      initialChildId: initialChildId,
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({required this.text, this.onRetry});
  final String text;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(text, textAlign: TextAlign.center),
            if (onRetry != null) ...[
              const SizedBox(height: 12),
              FilledButton.tonal(onPressed: onRetry, child: const Text('Повторить')),
            ],
          ],
        ),
      ),
    );
  }
}

class _ZoneEditorForm extends ConsumerStatefulWidget {
  const _ZoneEditorForm({
    super.key,
    required this.zone,
    required this.kids,
    required this.deviceTimeZone,
    this.initialCenter,
    this.initialZoom,
    this.initialChildId,
  });

  final Zone? zone;
  final List<Child> kids;
  final String? deviceTimeZone;
  final LatLng? initialCenter;
  final double? initialZoom;
  final String? initialChildId;

  @override
  ConsumerState<_ZoneEditorForm> createState() => _ZoneEditorFormState();
}

class _ZoneEditorFormState extends ConsumerState<_ZoneEditorForm> {
  final MapController _map = MapController();
  // Пересоздание TileLayer после onMapReady (workaround flutter_map 7.0.2).
  int _tileGen = 0;
  bool _mapReady = false;

  late final TextEditingController _name =
      TextEditingController(text: widget.zone?.name ?? '');
  late String _color =
      kZoneColors.contains(widget.zone?.color) ? widget.zone!.color : kZoneColorDefault;
  late String _icon = widget.zone?.icon ?? kZoneIconDefault;
  // Старые зоны могли быть меньше 100 м — подтягиваем в допустимое.
  late int _radius = clampRadius(widget.zone?.radius ?? kZoneRadiusDefault);
  // Новая зона — по умолчанию для всех детей, включая будущих.
  late bool _allChildren = widget.zone?.allChildren ?? true;
  late List<String> _childIds = _initialChildIds();
  late ScheduleDraft _schedule = ScheduleDraft.initial(widget.zone?.schedule);
  late ArrivalDraft _arrival = ArrivalDraft.initial(widget.zone?.arrival);

  late LatLng _center;
  late double _startZoom;
  LatLng? _me;
  bool _saving = false;

  bool get _isNew => widget.zone == null;

  List<String> _initialChildIds() {
    final z = widget.zone;
    if (z != null) return [...z.childIds];
    final fromChild = widget.initialChildId;
    if (fromChild != null) return [fromChild];
    return widget.kids.map((k) => k.id).toList();
  }

  @override
  void initState() {
    super.initState();
    final z = widget.zone;
    if (z != null) {
      _center = LatLng(z.centerLat, z.centerLon);
      _startZoom = zoomForRadius(_radius, z.centerLat);
    } else {
      final c = widget.initialCenter;
      _center = c ?? kMoscow;
      _startZoom = widget.initialZoom ?? (c != null ? 16 : kMoscowZoom);
      if (c == null) unawaited(_centerOnSavedView());
    }
  }

  /// Новая зона без координат в адресе — открываем в последнем виде карты.
  Future<void> _centerOnSavedView() async {
    final saved = await readSavedMapView(ref.read(authSessionProvider)?.user.id);
    if (saved == null || !mounted) return;
    setState(() => _center = saved.center);
    if (_mapReady) _map.move(saved.center, saved.zoom);
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  bool get _noChildrenSelected => !_allChildren && _childIds.isEmpty;
  bool get _rulesOn => _schedule.on || _arrival.on;
  String? get _rulesProblem =>
      _schedule.error ??
      _arrival.error ??
      (_rulesOn && widget.deviceTimeZone == null
          ? 'Телефон не сообщил часовой пояс — расписание и срок сохранить не получится.'
          : null);

  void _snack(String text) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(text)));
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      _snack('Укажите название зоны.');
      return;
    }
    if (_noChildrenSelected) {
      _snack('Выберите хотя бы одного ребёнка или включите «Все дети».');
      return;
    }
    final problem = _rulesProblem;
    if (problem != null) {
      _snack(problem);
      return;
    }
    final input = ZoneInput(
      name: _name.text,
      color: _color,
      icon: _icon,
      centerLat: _center.latitude,
      centerLon: _center.longitude,
      radius: _radius,
      allChildren: _allChildren,
      childIds: _childIds,
      // Пояс уходит при каждом сохранении (спека 2.1).
      timezone: widget.deviceTimeZone,
      schedule: _schedule.payload,
      arrival: _arrival.payload,
    );
    setState(() => _saving = true);
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    try {
      final repo = ref.read(zonesRepositoryProvider);
      if (_isNew) {
        await repo.create(input);
      } else {
        await repo.update(widget.zone!.id, input);
      }
      ref.invalidate(zonesListProvider);
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(_isNew ? 'Зона создана' : 'Зона обновлена')));
      navigator.pop();
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      _snack(zoneErrorMessage(e, ZoneAction.save));
    }
  }

  Future<void> _delete() async {
    final deleted = await deleteZoneWithConfirm(context, ref, widget.zone!);
    if (deleted && mounted) Navigator.of(context).pop();
  }

  Future<void> _whereAmI() async {
    final me = await locateMe(context);
    if (me == null || !mounted) return;
    setState(() => _me = me);
    if (_mapReady) _map.move(me, 16);
  }

  Future<int?> _pickTime(int currentMin) async {
    final picked = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(hour: currentMin ~/ 60, minute: currentMin % 60),
      builder: (ctx, child) => MediaQuery(
        data: MediaQuery.of(ctx).copyWith(alwaysUse24HourFormat: true),
        child: child!,
      ),
    );
    return picked == null ? null : picked.hour * 60 + picked.minute;
  }

  Future<void> _pickScheduleStart() async {
    final m = await _pickTime(_schedule.startMin);
    if (m == null || !mounted) return;
    setState(() => _schedule = _schedule.copyWith(startMin: m));
  }

  Future<void> _pickScheduleEnd() async {
    final m = await _pickTime(_schedule.endMin);
    if (m == null || !mounted) return;
    setState(() => _schedule = _schedule.copyWith(endMin: m));
  }

  Future<void> _pickDeadline() async {
    final m = await _pickTime(_arrival.deadlineMin);
    if (m == null || !mounted) return;
    setState(() => _arrival = _arrival.copyWith(deadlineMin: m));
  }

  void _onPositionChanged(MapCamera camera, bool hasGesture) {
    if (camera.center == _center) return;
    setState(() => _center = camera.center);
  }

  static List<int> _graceOptions(int current) {
    final base = [0, 5, 10, 15, 20, 30, 45, 60, 90, 120];
    if (!base.contains(current)) base.add(current);
    base.sort();
    return base;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final color = parseZoneColor(_color);
    final canSave = !_saving && !_noChildrenSelected && _rulesProblem == null;

    return Scaffold(
      appBar: AppBar(
        title: Text(_isNew ? 'Новая зона' : 'Изменить зону'),
        actions: [
          if (!_isNew)
            IconButton(
              tooltip: 'Удалить зону',
              icon: const Icon(Icons.delete_outline),
              onPressed: _saving ? null : _delete,
            ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: FilledButton(
            onPressed: canSave ? _save : null,
            child: Text(_saving ? 'Сохраняем…' : 'Сохранить'),
          ),
        ),
      ),
      // Карта — вне ListView: иначе вертикальный жест по карте забирает скролл.
      body: Column(
        children: [
          SizedBox(height: 260, child: _buildMap(color)),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.only(bottom: 24),
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                  child: Text(
                    'Двигайте карту — центр зоны там, где пин.',
                    style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                  child: _buildMainFields(theme, scheme),
                ),
                ..._buildChildrenFields(scheme),
                const SizedBox(height: 8),
                _buildScheduleSection(),
                _buildArrivalSection(),
                if (_rulesOn)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                    child: _TimeZoneNote(
                      deviceTz: widget.deviceTimeZone,
                      zoneTz: (widget.zone?.schedule != null || widget.zone?.arrival != null)
                          ? widget.zone?.timezone
                          : null,
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMainFields(ThemeData theme, ColorScheme scheme) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Радиус: ${formatRadius(_radius)}', style: theme.textTheme.titleSmall),
        Slider(
          value: sliderFromRadius(_radius),
          onChanged: (t) => setState(() => _radius = radiusFromSlider(t)),
        ),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(formatRadius(kZoneRadiusMin), style: theme.textTheme.bodySmall),
            Text(formatRadius(kZoneRadiusMax), style: theme.textTheme.bodySmall),
          ],
        ),
        const SizedBox(height: 16),
        TextField(
          controller: _name,
          maxLength: 60,
          textCapitalization: TextCapitalization.sentences,
          decoration: const InputDecoration(
            labelText: 'Название',
            hintText: 'Например: Школа',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 8),
        Text('Цвет', style: theme.textTheme.titleSmall),
        const SizedBox(height: 8),
        Wrap(
          spacing: 12,
          children: [
            for (final c in kZoneColors)
              Semantics(
                label: 'Цвет $c',
                selected: c == _color,
                button: true,
                child: InkWell(
                  customBorder: const CircleBorder(),
                  onTap: () => setState(() => _color = c),
                  child: Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(
                      color: parseZoneColor(c),
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: c == _color ? scheme.onSurface : Colors.transparent,
                        width: 3,
                      ),
                    ),
                    child: c == _color
                        ? const Icon(Icons.check, color: Colors.white, size: 18)
                        : null,
                  ),
                ),
              ),
          ],
        ),
        const SizedBox(height: 16),
        Text('Иконка', style: theme.textTheme.titleSmall),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 4,
          children: [
            for (final i in kZoneIcons)
              ChoiceChip(
                avatar: Icon(i.icon, size: 18),
                label: Text(i.label),
                selected: i.id == _icon,
                showCheckmark: false,
                onSelected: (_) => setState(() => _icon = i.id),
              ),
          ],
        ),
        const SizedBox(height: 16),
        Text('Дети', style: theme.textTheme.titleSmall),
      ],
    );
  }

  List<Widget> _buildChildrenFields(ColorScheme scheme) {
    return [
      SwitchListTile(
        title: const Text('Все дети, включая будущих'),
        subtitle: _allChildren
            ? const Text('Зона будет работать для всех детей семьи, в том числе добавленных позже.')
            : null,
        value: _allChildren,
        onChanged: (v) => setState(() => _allChildren = v),
      ),
      if (!_allChildren && widget.kids.isEmpty)
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Text(
            'В семье пока нет детей — включите «Все дети», чтобы зона заработала, '
            'когда ребёнок появится.',
            style: TextStyle(color: scheme.error),
          ),
        ),
      if (!_allChildren)
        for (final k in widget.kids)
          CheckboxListTile(
            dense: true,
            controlAffinity: ListTileControlAffinity.leading,
            contentPadding: const EdgeInsets.only(left: 32, right: 16),
            title: Text(k.name),
            value: _childIds.contains(k.id),
            onChanged: (v) => setState(() {
              _childIds = [..._childIds.where((id) => id != k.id), if (v == true) k.id];
            }),
          ),
      if (widget.kids.isNotEmpty && _noChildrenSelected)
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Text('Выберите хотя бы одного ребёнка.', style: TextStyle(color: scheme.error)),
        ),
    ];
  }

  Widget _buildScheduleSection() {
    final error = _schedule.error;
    return _RuleSection(
      title: 'Расписание уведомлений',
      description: _schedule.on
          ? 'Push о приходе и уходе — только в эти дни и часы. События в ленте пишутся всегда.'
          : 'Сейчас уведомления о приходе и уходе приходят круглосуточно.',
      on: _schedule.on,
      onToggle: (v) => setState(() => _schedule = _schedule.copyWith(on: v)),
      children: [
        DayChips(
          mask: _schedule.daysMask,
          onChanged: (m) => setState(() => _schedule = _schedule.copyWith(daysMask: m)),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          children: [
            OutlinedButton(
              onPressed: _pickScheduleStart,
              child: Text('С ${minutesToHhmm(_schedule.startMin)}'),
            ),
            OutlinedButton(
              onPressed: _pickScheduleEnd,
              child: Text('До ${minutesToHhmm(_schedule.endMin)}'),
            ),
          ],
        ),
        if (error != null)
          _Note(error, error: true)
        else if (isOvernight(_schedule.startMin, _schedule.endMin))
          _Note('Окно через полночь: с ${minutesToHhmm(_schedule.startMin)} до '
              '${minutesToHhmm(_schedule.endMin)} следующего дня.'),
      ],
    );
  }

  Widget _buildArrivalSection() {
    final error = _arrival.error;
    return _RuleSection(
      title: 'Не пришёл к сроку',
      description: 'Push, если ребёнок не пришёл в зону к указанному времени. '
          'Проверяется для всех детей зоны.',
      on: _arrival.on,
      onToggle: (v) => setState(() => _arrival = _arrival.copyWith(on: v)),
      children: [
        Wrap(
          spacing: 12,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            OutlinedButton(
              onPressed: _pickDeadline,
              child: Text('Срок ${minutesToHhmm(_arrival.deadlineMin)}'),
            ),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('Запас '),
                DropdownButton<int>(
                  value: _arrival.graceMin,
                  items: [
                    for (final g in _graceOptions(_arrival.graceMin))
                      DropdownMenuItem(value: g, child: Text('$g мин')),
                  ],
                  onChanged: (g) {
                    if (g == null) return;
                    setState(() => _arrival = _arrival.copyWith(graceMin: g));
                  },
                ),
              ],
            ),
          ],
        ),
        const SizedBox(height: 8),
        DayChips(
          mask: _arrival.daysMask,
          onChanged: (m) => setState(() => _arrival = _arrival.copyWith(daysMask: m)),
        ),
        if (error != null)
          _Note(error, error: true)
        else
          _Note('Проверка — через ${_arrival.graceMin} мин после срока.'),
      ],
    );
  }

  Widget _buildMap(Color color) {
    return Stack(
      // StackFit.expand ОБЯЗАТЕЛЕН: иначе FlutterMap может стартовать с size=0.
      fit: StackFit.expand,
      children: [
        FlutterMap(
          mapController: _map,
          options: MapOptions(
            initialCenter: _center,
            initialZoom: _startZoom,
            minZoom: 3,
            maxZoom: 18,
            interactionOptions: const InteractionOptions(
              flags: InteractiveFlag.all & ~InteractiveFlag.rotate,
            ),
            onPositionChanged: _onPositionChanged,
            onMapReady: () {
              if (!mounted) return;
              setState(() {
                _mapReady = true;
                _tileGen++;
              });
            },
          ),
          children: [
            TileLayer(
              key: ValueKey('tile_$_tileGen'),
              urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              userAgentPackageName: 'pro.periscop.parent',
              maxNativeZoom: 19,
              keepBuffer: 4,
              panBuffer: 2,
            ),
            CircleLayer(
              circles: [
                CircleMarker(
                  point: _center,
                  radius: _radius.toDouble(),
                  useRadiusInMeter: true,
                  color: color.withValues(alpha: 0.2),
                  borderColor: color,
                  borderStrokeWidth: 2,
                ),
              ],
            ),
            if (_me != null)
              MarkerLayer(markers: [
                Marker(point: _me!, width: 18, height: 18, child: const MyLocationDot()),
              ]),
            const RichAttributionWidget(
              attributions: [TextSourceAttribution('OpenStreetMap contributors')],
            ),
          ],
        ),
        // Пин по центру: остриё — в центре карты (= центр зоны).
        IgnorePointer(
          child: Center(
            child: Transform.translate(
              offset: const Offset(0, -20),
              child: Icon(
                Icons.location_on,
                size: 44,
                color: color,
                shadows: const [Shadow(color: Colors.black38, blurRadius: 4)],
              ),
            ),
          ),
        ),
        Positioned(
          right: 12,
          top: 12,
          child: FloatingActionButton.small(
            heroTag: 'zone_editor_where_am_i',
            tooltip: 'Где я',
            onPressed: _whereAmI,
            child: const Icon(Icons.my_location),
          ),
        ),
      ],
    );
  }
}

class _RuleSection extends StatelessWidget {
  const _RuleSection({
    required this.title,
    required this.description,
    required this.on,
    required this.onToggle,
    required this.children,
  });

  final String title;
  final String description;
  final bool on;
  final ValueChanged<bool> onToggle;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      elevation: 0,
      margin: const EdgeInsets.fromLTRB(16, 4, 16, 8),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: scheme.outlineVariant),
      ),
      child: Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SwitchListTile(
              title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
              subtitle: Text(description),
              value: on,
              onChanged: onToggle,
            ),
            if (on)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: children,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _Note extends StatelessWidget {
  const _Note(this.text, {this.error = false});
  final String text;
  final bool error;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Text(
        text,
        style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: error ? scheme.error : scheme.onSurfaceVariant,
            ),
      ),
    );
  }
}

/// Подпись о поясе; предупреждает, если зона была настроена в другом поясе.
class _TimeZoneNote extends StatelessWidget {
  const _TimeZoneNote({required this.deviceTz, required this.zoneTz});
  final String? deviceTz;
  final String? zoneTz;

  @override
  Widget build(BuildContext context) {
    final tz = deviceTz;
    if (tz == null) {
      return const _Note(
        'Телефон не сообщил часовой пояс — расписание и срок сохранить не получится.',
        error: true,
      );
    }
    final differs = zoneTz != null && zoneTz != tz;
    final suffix = differs
        ? ' Раньше время зоны было задано по поясу $zoneTz — после сохранения будет по вашему.'
        : '';
    return _Note('Время по поясу $tz.$suffix');
  }
}
