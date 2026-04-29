/// Модели аутентификации.
///
/// Бэкенд отдаёт `verifyOtp` / `loginPassword` / `refresh`:
///   { accessToken, refreshToken, user: {id,email,role,name?}, family: {id,name?} }
class AuthUser {
  AuthUser({required this.id, required this.email, required this.role, this.name});

  final String id;
  final String email;
  final String role; // 'owner' | 'parent'
  final String? name;

  factory AuthUser.fromJson(Map<String, dynamic> json) => AuthUser(
        id: json['id'] as String,
        email: json['email'] as String,
        role: (json['role'] as String?) ?? 'owner',
        name: json['name'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'email': email,
        'role': role,
        if (name != null) 'name': name,
      };
}

class AuthFamily {
  AuthFamily({required this.id, this.name});

  final String id;
  final String? name;

  factory AuthFamily.fromJson(Map<String, dynamic> json) =>
      AuthFamily(id: json['id'] as String, name: json['name'] as String?);

  Map<String, dynamic> toJson() => {'id': id, if (name != null) 'name': name};
}

class AuthSession {
  AuthSession({
    required this.accessToken,
    required this.refreshToken,
    required this.user,
    required this.family,
  });

  final String accessToken;
  final String refreshToken;
  final AuthUser user;
  final AuthFamily family;
}
