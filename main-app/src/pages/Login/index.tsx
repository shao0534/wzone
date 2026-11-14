import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPublicKey, login } from '../../api/auth';
import { encryptCredentials } from '../../utils/rsa';
import { useAuthStore } from '../../store/authStore';
import './index.less';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (loading) return;
    setError('');

    const name = username.trim();
    if (!name || !password) {
      setError('请输入用户名和密码');
      return;
    }

    setLoading(true);
    try {
      // 1. 取服务端公钥 -> 2. 本地 RSA-OAEP 加密 -> 3. 只把密文发给后端
      const { publicKey } = await getPublicKey();
      const cipher = await encryptCredentials(publicKey, {
        username: name,
        password,
        ts: Date.now(),
      });
      const result = await login(cipher);
      setSession(result.token, result.user);
      navigate('/blog', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-hero">
        <div className="hero-title">树屋</div>
        <div className="hero-sub">一处安静的栖息地</div>
      </div>

      <form className="login-card" onSubmit={submit}>
        <div className="card-head">
          <h1>欢迎回来</h1>
          <p>登录后继续使用树屋</p>
        </div>

        <label htmlFor="login-name">用户名</label>
        <input
          id="login-name"
          className="login-input"
          type="text"
          autoComplete="username"
          placeholder="请输入用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={loading}
        />

        <label htmlFor="login-pwd">密码</label>
        <input
          id="login-pwd"
          className="login-input"
          type="password"
          autoComplete="current-password"
          placeholder="请输入密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
        />

        {error && <div className="login-error" role="alert">{error}</div>}

        <button className="login-submit" type="submit" disabled={loading}>
          {loading ? '登录中…' : '登 录'}
        </button>

        <div className="login-foot">凭据经 RSA 加密后传输</div>
      </form>
    </div>
  );
}
