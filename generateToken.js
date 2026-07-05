const { signJwt } = require("../config/jwt");

/**
 * Signs a JWT for a user and attaches it as an httpOnly cookie on the response.
 * Also returns the token/user payload as JSON for clients (like the admin
 * dashboard) that store the token in memory/localStorage instead of relying
 * on the cookie.
 */
function generateTokenAndRespond(res, user, statusCode = 200) {
  const token = signJwt({ id: user._id, role: user.role });

  const cookieDays = Number(process.env.COOKIE_EXPIRES_DAYS || 7);
  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: cookieDays * 24 * 60 * 60 * 1000,
  });

  res.status(statusCode).json({
    success: true,
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
}

module.exports = generateTokenAndRespond;
