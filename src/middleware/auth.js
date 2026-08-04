import jwt from "jsonwebtoken";

/**
 * Express "middleware" — a function that runs before a route's main
 * logic, and can either let the request continue (by calling next())
 * or stop it early (by sending a response). This one checks for a
 * valid JWT before allowing access to whatever route it's attached to.
 */
export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization; // expects "Bearer <token>"

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid authorization header" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.touristId = payload.touristId; // attach it, so routes can use it
    next(); // proceed to the actual route
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}