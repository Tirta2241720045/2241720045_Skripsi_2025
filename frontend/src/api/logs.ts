import API from './axios';

export const getAllLogs = async (params?: {
  user_id?: number;
  start_date?: string;
  end_date?: string;
  action_keyword?: string;
  limit?: number;
}) => {
  const response = await API.get('/logs/', { params });
  return response.data;
};

export const getLogsByUser = async (user_id: number, limit?: number) => {
  const response = await API.get(`/logs/user/${user_id}`, {
    params: limit ? { limit } : undefined,
  });
  return response.data;
};

export const cleanupLogs = async (older_than_days: number = 90) => {
  const response = await API.delete('/logs/cleanup', {
    params: { older_than_days },
  });
  return response.data;
};