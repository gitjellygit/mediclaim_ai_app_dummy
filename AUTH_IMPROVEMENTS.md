# Authentication & Authorization Improvements

This document outlines the industry-standard authentication and authorization improvements made to the Claim AI MVP.

## 🎯 Overview

The authentication system has been upgraded from a basic POC to an industry-standard implementation with proper security practices, token management, and role-based access control.

## 🔐 Backend Improvements

### 1. **Refresh Token Mechanism**
- **Access Tokens**: Short-lived (15 minutes) for API requests
- **Refresh Tokens**: Long-lived (7 days) stored securely in database
- Automatic token rotation on refresh
- Token revocation support

### 2. **Security Enhancements**
- **Account Lockout**: After 5 failed login attempts, account is locked for 30 minutes
- **Rate Limiting**: Prevents brute force attacks (5 attempts per 15 minutes per email)
- **Password Security**: Industry-standard bcrypt hashing (12 rounds)
- **Token Expiration**: Proper JWT expiration handling with clear error messages

### 3. **Error Handling**
- Consistent error response format
- Security-conscious error messages (don't reveal if user exists)
- Proper HTTP status codes (401, 403, 423, 429)
- Detailed error logging for debugging

### 4. **Database Schema Updates**
- `RefreshToken` model for secure token storage
- User security fields: `failedLoginAttempts`, `lockedUntil`, `lastLoginAt`
- Proper indexes for performance
- Cascade deletion for security

### 5. **API Endpoints**
- `POST /api/auth/login` - Enhanced login with refresh tokens
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Revoke refresh token
- `POST /api/auth/logout-all` - Revoke all user sessions
- `GET /api/auth/me` - Get current authenticated user

### 6. **Middleware Improvements**
- `requireAuth` - Enhanced JWT validation with proper error handling
- `requireRoles` - Role-based authorization middleware
- `optionalAuth` - Optional authentication for public endpoints
- Better token validation and error messages

## 🎨 Frontend Improvements

### 1. **Automatic Token Refresh**
- Automatic token refresh before expiration (1-minute buffer)
- Seamless user experience - no interruptions
- Handles token expiration gracefully

### 2. **Enhanced Auth Context**
- Proper state management with React Context
- Automatic user verification on app load
- Token validation with backend
- Proper cleanup on logout

### 3. **Role-Based Route Protection**
- `ProtectedRoute` - Requires authentication
- `RoleProtectedRoute` - Requires specific roles
- Automatic redirects for unauthorized access
- Loading states during auth checks

### 4. **API Client Improvements**
- Automatic token injection in requests
- Token refresh on 401 errors
- Better error handling and messages
- Proper token expiration detection

### 5. **User Experience**
- Smooth login/logout flow
- No page reloads needed
- Proper error messages
- Session persistence

## 🔒 Security Features

### Industry-Standard Practices Implemented:

1. **Token Management**
   - Short-lived access tokens (15 min)
   - Long-lived refresh tokens (7 days)
   - Secure token storage
   - Token revocation

2. **Account Security**
   - Account lockout after failed attempts
   - Rate limiting on login
   - Password strength validation (ready for use)
   - Last login tracking

3. **Authorization**
   - Role-based access control (RBAC)
   - Route-level protection
   - API-level protection
   - Proper 403 Forbidden responses

4. **Error Handling**
   - No user enumeration (same error for invalid email/password)
   - Proper HTTP status codes
   - Security-conscious error messages
   - Detailed logging for debugging

## 📋 Database Migration

Run the migration to add the new tables and fields:

```bash
cd backend
npx prisma migrate dev
```

This will create:
- `RefreshToken` table
- Security fields on `User` table (`failedLoginAttempts`, `lockedUntil`, `lastLoginAt`, `updatedAt`)

## 🚀 Environment Variables

Add these to your `.env` file:

```env
JWT_SECRET=your-secret-key-here-min-32-chars
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=7d
```

## 📝 Usage Examples

### Backend - Protecting Routes

```javascript
// Require authentication
app.use("/api/claims", requireAuth, claimsRouter);

// Require specific roles
app.use("/api/rules", requireAuth, requireRoles(["ADMIN"]), rulesRouter);
```

### Frontend - Protecting Routes

```jsx
// Require authentication
<ProtectedRoute>
  <YourComponent />
</ProtectedRoute>

// Require specific roles
<RoleProtectedRoute allowedRoles={["ADMIN", "CASHIER"]}>
  <YourComponent />
</RoleProtectedRoute>
```

### Frontend - Using Auth Context

```jsx
import { useAuth } from "../context/AuthContext.jsx";

function MyComponent() {
  const { user, logout, refreshUser } = useAuth();
  
  // user: { id, email, role }
  // logout: async function
  // refreshUser: async function
}
```

## 🔄 Token Flow

1. **Login**: User logs in → receives `accessToken` + `refreshToken`
2. **API Requests**: Access token sent in `Authorization: Bearer <token>` header
3. **Token Expiry**: Access token expires after 15 minutes
4. **Auto Refresh**: Frontend automatically refreshes token before expiry
5. **Refresh Flow**: Uses refresh token to get new access token
6. **Logout**: Refresh token revoked, access token invalidated

## 🛡️ Security Considerations

### Current Implementation
- ✅ JWT tokens with expiration
- ✅ Refresh token mechanism
- ✅ Account lockout
- ✅ Rate limiting
- ✅ Role-based access control
- ✅ Token revocation
- ✅ Secure password hashing

### Future Enhancements (Optional)
- [ ] HTTP-only cookies for refresh tokens (more secure than localStorage)
- [ ] CSRF protection
- [ ] Two-factor authentication (2FA)
- [ ] Password reset flow
- [ ] Email verification
- [ ] Session management UI
- [ ] Audit logging
- [ ] Redis for rate limiting (instead of in-memory)

## 📚 Files Changed

### Backend
- `src/routes/auth.js` - Complete rewrite with refresh tokens
- `src/middleware/auth.js` - Enhanced with better error handling
- `src/utils/security.js` - New security utilities
- `src/index.js` - Updated auth routes
- `prisma/schema.prisma` - Added RefreshToken model and security fields

### Frontend
- `src/api/auth.js` - Updated for refresh tokens
- `src/api/client.js` - Automatic token refresh
- `src/context/AuthContext.jsx` - Enhanced state management
- `src/components/ProtectedRoute.jsx` - New role-based protection
- `src/App.jsx` - Updated route protection
- `src/components/TopNav.jsx` - Updated logout flow
- `src/pages/Login.jsx` - Already updated for new auth flow

## ✅ Testing Checklist

- [x] Login with valid credentials
- [x] Login with invalid credentials (account lockout)
- [x] Token refresh on expiry
- [x] Logout revokes tokens
- [x] Protected routes require auth
- [x] Role-based routes enforce roles
- [x] Rate limiting works
- [x] Account lockout works
- [x] Token expiration handled gracefully

## 🎉 Summary

The authentication system is now production-ready with:
- ✅ Industry-standard security practices
- ✅ Proper token management
- ✅ Role-based access control
- ✅ Account security features
- ✅ Better error handling
- ✅ Seamless user experience

All changes are backward compatible with existing code, and the system gracefully handles edge cases and errors.
