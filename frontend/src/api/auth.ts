import API from './axios';
import qs from 'qs';

export const login = async (username: string, password: string) => {
  const response = await API.post('/auth/login',
    qs.stringify({ username, password }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  if (response.data.access_token) {
    localStorage.setItem('access_token', response.data.access_token);
    localStorage.setItem('user', JSON.stringify({
      user_id:   response.data.user_id,
      username:  response.data.username,
      role:      response.data.role,
      full_name: response.data.full_name
    }));
  }

  return response.data;
};

export const logout = () => {
  localStorage.removeItem('access_token');
  localStorage.removeItem('user');
};

export const getCurrentUser = () => {
  const userStr = localStorage.getItem('user');
  if (!userStr) return null;
  try {
    return JSON.parse(userStr);
  } catch {
    return null;
  }
};

export const getToken = () => {
  return localStorage.getItem('access_token');
};

export const createUser = async (username: string, password: string, full_name: string, role: string) => {
  const response = await API.post('/auth/create-user',
    qs.stringify({ username, password, full_name, role }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return response.data;
};

export const getUsers = async () => {
  const response = await API.get('/auth/users');
  return response.data;
};

export const getUser = async (user_id: number) => {
  const response = await API.get(`/auth/users/${user_id}`);
  return response.data;
};

export const updateUser = async (user_id: number, username?: string, full_name?: string, role?: string, password?: string) => {
  const data: any = {};
  if (username)   data.username   = username;
  if (full_name)  data.full_name  = full_name;
  if (role)       data.role       = role;
  if (password)   data.password   = password;

  const response = await API.put(`/auth/users/${user_id}`,
    qs.stringify(data),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return response.data;
};

export const deleteUser = async (user_id: number) => {
  const response = await API.delete(`/auth/users/${user_id}`);
  return response.data;
};

export const getMe = async () => {
  const response = await API.get('/auth/me');
  return response.data;
};