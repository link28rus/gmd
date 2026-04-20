class RetryPolicy {
  const RetryPolicy({this.maxAttempts = 5});
  final int maxAttempts;

  bool canRetry(int attempts) => attempts < maxAttempts;

  Duration nextDelay(int attempt) {
    final seconds = (1 << attempt).clamp(1, 300);
    return Duration(seconds: seconds);
  }
}
