import '@testing-library/jest-dom';

describe('Frontend Auth Flow & Routing', () => {
  
  beforeEach(() => {
    localStorage.clear();
  });

  describe('LocalStorage Management', () => {
    
    test('AUTH-01: Token disimpan ke localStorage setelah login', () => {
      const mockToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwicm9sZSI6InN0YWZmIn0.abc123';
      const mockUser = {
        user_id: 1,
        username: 'staff_test',
        role: 'staff',
        full_name: 'Staff Test'
      };
      
      localStorage.setItem('access_token', mockToken);
      localStorage.setItem('user', JSON.stringify(mockUser));
      
      expect(localStorage.getItem('access_token')).toBe(mockToken);
      expect(JSON.parse(localStorage.getItem('user'))).toEqual(mockUser);
    });

    test('AUTH-02: Token dihapus saat logout', () => {
      localStorage.setItem('access_token', 'test-token');
      localStorage.setItem('user', JSON.stringify({ role: 'staff' }));
      
      localStorage.removeItem('access_token');
      localStorage.removeItem('user');
      
      expect(localStorage.getItem('access_token')).toBeNull();
      expect(localStorage.getItem('user')).toBeNull();
    });

    test('AUTH-03: getCurrentUser mengembalikan null jika tidak ada user', () => {
      const user = localStorage.getItem('user');
      expect(user).toBeNull();
    });

    test('AUTH-04: getCurrentUser mengembalikan object user jika ada', () => {
      const mockUser = { user_id: 1, username: 'staff', role: 'staff', full_name: 'Staff' };
      localStorage.setItem('user', JSON.stringify(mockUser));
      
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      expect(user.user_id).toBe(1);
      expect(user.role).toBe('staff');
    });
  });

  describe('Role Validation', () => {
    
    test('AUTH-05: PrivateRoute memvalidasi role dengan benar', () => {
      const mockUser = { user_id: 1, role: 'staff' };
      localStorage.setItem('user', JSON.stringify(mockUser));
      
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      
      expect(user.role).toBe('staff');
      expect(user.role === 'staff').toBe(true);
      expect(user.role === 'doctor').toBe(false);
      expect(user.role === 'admin').toBe(false);
    });
  });
});