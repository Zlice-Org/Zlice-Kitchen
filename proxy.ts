import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { loginRateLimit, apiRateLimit, signupRateLimit } from '@/lib/rate-limit';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Rate limit user registration endpoint
  if (pathname.startsWith('/api/user/register')) {
    const ip = request.headers.get('x-forwarded-for') ?? 'anonymous';
    try {
      const { success, limit, remaining, reset } = await signupRateLimit.limit(ip);
      
      if (!success) {
        console.log('Use of rate limit exceeded for registration');
        return NextResponse.json(
          { error: 'Too many registration attempts. Please try again later.' },
          { 
            status: 429,
            headers: {
              'X-RateLimit-Limit': limit.toString(),
              'X-RateLimit-Remaining': remaining.toString(),
              'X-RateLimit-Reset': reset.toString(),
            }
          }
        );
      }
    } catch (e) {
      console.warn('Signup rate limit skipped due to error:', e);
    }
  }

  // Rate limit login endpoints
  if (pathname.startsWith('/api/auth/login') || pathname.startsWith('/api/delivery/login')) {
    const ip = request.headers.get('x-forwarded-for') ?? 'anonymous';
    console.log('Login attempt from IP:', ip);
    try {
      const { success, limit, remaining, reset } = await loginRateLimit.limit(ip);
      
      if (!success) {
        return NextResponse.json(
          { error: 'Too many login attempts. Please try again later.' },
          { 
            status: 429,
            headers: {
              'X-RateLimit-Limit': limit.toString(),
              'X-RateLimit-Remaining': remaining.toString(),
              'X-RateLimit-Reset': reset.toString(),
            }
          }
        );
      }
    } catch (e) {
      console.warn('Login rate limit skipped due to error:', e);
    }
  }

  // Rate limit general API endpoints (excluding auth endpoints)
  if (pathname.startsWith('/api/') && !pathname.startsWith('/api/auth/')) {
    const authToken = request.cookies.get('auth_token')?.value;
    const isReadOperation = request.method === 'GET';

    // 🚀 FAST LANE: Authenticated users reading data skip the rate limit check
    if (authToken && isReadOperation) {
      // Skip rate limit check for speed
    } 
    // 🛡️ SAFETY LANE: Write operations and anonymous users are checked
    else {
      const ip = request.headers.get('x-forwarded-for') ?? 'anonymous';
      const identifier = authToken ?? ip;
      
      try {
        const { success, limit, remaining, reset } = await apiRateLimit.limit(identifier);
        
        if (!success) {
          return NextResponse.json(
            { error: 'Rate limit exceeded. Please slow down.' },
            { 
              status: 429,
              headers: {
                'X-RateLimit-Limit': limit.toString(),
                'X-RateLimit-Remaining': remaining.toString(),
                'X-RateLimit-Reset': reset.toString(),
              }
            }
          );
        }
      } catch (e) {
        console.warn('API rate limit skipped due to error:', e);
      }
    }
  }
  
  // Get auth token from cookie
  const authToken = request.cookies.get('auth_token')?.value;
  const userType = request.cookies.get('user_type')?.value;

  // Public paths that don't require authentication
  const publicPaths = ['/login', '/api/coupons', '/admin', '/delivery/login', '/api/auth/login', '/api/auth/me', '/api/delivery/login', '/api/user/register', '/verification', '/manifest.json', '/delivery-manifest.json', '/sw.js', '/delivery-sw.js', '/delivery-offline.html', '/icon-192.png', '/icon-512.png', '/icon-192-pwa.png', '/icon-512-pwa.png', '/delivery-icon-192.png', '/delivery-icon-512.png'];
  const isPublicPath = publicPaths.some(path => pathname.startsWith(path));

  // If trying to access protected route without auth, redirect to appropriate login
  if (!isPublicPath && !authToken) {
    console.log(`[Proxy] Unauthorized access to ${pathname}. Redirecting to login.`);
    // Return 401 for API routes instead of redirecting
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Redirect delivery routes to delivery login
    if (pathname.startsWith('/delivery')) {
      return NextResponse.redirect(new URL('/delivery/login', request.url));
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Delivery-only routes
  const deliveryOnlyPaths = ['/delivery/orders'];
  const isDeliveryOnlyPath = deliveryOnlyPaths.some(path => pathname.startsWith(path));

  if (isDeliveryOnlyPath && userType !== 'delivery') {
    console.log(`[Proxy] Invalid user type for delivery path ${pathname}. UserType: ${userType}`);
    return NextResponse.redirect(new URL('/delivery/login', request.url));
  }

  // Super Admin only routes
  const superAdminPaths = ['/admin/canteens'];
  const isSuperAdminPath = superAdminPaths.some(path => pathname.startsWith(path));

  if (isSuperAdminPath && userType !== 'super_admin') {
    console.log(`[Proxy] Invalid user type for super_admin path ${pathname}. UserType: ${userType}`);
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // Canteen-only routes (super admin and delivery cannot access these)
  const canteenOnlyPaths = ['/dashboard', '/menu', '/orders', '/transactions', '/khata', '/display', '/settings', '/canteen'];
  const isCanteenOnlyPath = canteenOnlyPaths.some(path => pathname.startsWith(path));

  if (isCanteenOnlyPath && userType !== 'canteen') {
    console.log(`[Proxy] Invalid user type for canteen path ${pathname}. UserType: ${userType}`);
    if (userType === 'super_admin') {
      return NextResponse.redirect(new URL('/admin/canteens', request.url));
    }
    if (userType === 'delivery') {
      return NextResponse.redirect(new URL('/delivery/orders', request.url));
    }
    // Fallback: Any other invalid state redirects to login
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const verificationStatus = request.cookies.get('verification_status')?.value;

  // Enforce verification undertaking for new accounts
  if (isCanteenOnlyPath && userType === 'canteen') {
    if (!verificationStatus || verificationStatus === 'not_started') {
      console.log(`[Proxy] Kitchen verification not started. Redirecting to /verification.`);
      return NextResponse.redirect(new URL('/verification', request.url));
    }
  }

  // Verified or under_review canteen on verification pages → send them to dashboard
  if (pathname === '/verification' && userType === 'canteen' && (verificationStatus === 'verified' || verificationStatus === 'under_review')) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // If authenticated and trying to access login pages, redirect appropriately
  if (isPublicPath && authToken) {
    if (pathname === '/delivery/login' && userType === 'delivery') {
      return NextResponse.redirect(new URL('/delivery/orders', request.url));
    }
    if ((pathname === '/login' || pathname === '/admin') && userType !== 'delivery') {
      const redirectUrl = userType === 'super_admin' ? '/admin/canteens' : '/dashboard';
      return NextResponse.redirect(new URL(redirectUrl, request.url));
    }
  }

  const response = NextResponse.next();
  // Security Headers
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');

  return response;
}

export const config = {
  matcher: [
'/((?!_next/static|_next/image|favicon.ico|public|manifest.json|sw.js|offline.html|.*\\.png|.*\\.jpg|.*\\.mp3|.*\\.svg).*)',
  ],
};
