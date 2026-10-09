import { initialNameParts, namePayload, validateNameParts } from './profile-name';

describe('initialNameParts', () => {
  it('берёт сохранённые части ФИО', () => {
    expect(
      initialNameParts({ name: 'x', lastName: 'Иванов', firstName: 'Пётр', middleName: null }),
    ).toEqual({ lastName: 'Иванов', firstName: 'Пётр', middleName: '' });
  });
  it('частей нет — раскладывает name', () => {
    expect(initialNameParts({ name: 'Четверик Нина Александровна' })).toEqual({
      lastName: 'Четверик',
      firstName: 'Нина',
      middleName: 'Александровна',
    });
    expect(initialNameParts({ name: ' Мама ' })).toEqual({
      lastName: '',
      firstName: 'Мама',
      middleName: '',
    });
    expect(initialNameParts({ name: null })).toEqual({
      lastName: '',
      firstName: '',
      middleName: '',
    });
  });
});

describe('validateNameParts', () => {
  const ok = { lastName: 'Иванов', firstName: 'Пётр', middleName: '' };
  it('фамилия и имя обязательны, отчество — нет', () => {
    expect(validateNameParts(ok)).toBeNull();
    expect(validateNameParts({ ...ok, lastName: '  ' })).toBe('Укажите фамилию');
    expect(validateNameParts({ ...ok, firstName: '' })).toBe('Укажите имя');
  });
  it('длина и запрещённые символы', () => {
    expect(validateNameParts({ ...ok, middleName: 'x'.repeat(81) })).toMatch(/80/);
    expect(validateNameParts({ ...ok, lastName: '<b>' })).toMatch(/символы/);
  });
});

describe('namePayload', () => {
  it('обрезает пробелы, пустое отчество → null', () => {
    expect(namePayload({ lastName: ' Иванов ', firstName: 'Пётр', middleName: ' ' })).toEqual({
      lastName: 'Иванов',
      firstName: 'Пётр',
      middleName: null,
    });
  });
});
