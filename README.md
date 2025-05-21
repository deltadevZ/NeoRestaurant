# Neo Restaurant Management System

A full-featured Node.js/Express/EJS application for managing restaurant reservations, orders, inventory, and staff schedules.

---

## Features

- **Live Booking Reservations**: Customers can book tables online.
- **Order Management**: Staff can create, edit, and manage orders.
- **Inventory Tracking**: Manage stock, suppliers, and low inventory alerts.
- **Staff Scheduling**: Managers can assign shifts; staff can view their schedules.
- **Secure Staff Login**: Passwords are securely hashed.

---

## Getting Started

### 1. Clone the repository
```sh
git clone <your-repo-url>
cd Neo-Restaurant
```

### 2. Install dependencies
```sh
npm install
```

### 3. Set up the database
```sh
node database_setup.js
```
This will create and seed the SQLite database with sample data.

### 4. Start the server
```sh
npm start
```
The app will run at [http://localhost:3000](http://localhost:3000).

---

## Usage

- **Customer**: Go to `/reserve` to make a reservation.
- **Staff**: Log in at `/staff/login` (sample accounts are seeded in the database).
- **Dashboard**: After login, access all management features from the staff dashboard.

---

## Sample Staff Accounts

- **Manager**
  - Username: `manager`
  - Password: `password123`
- **Waiter**
  - Username: `waiter`
  - Password: `password123`

---

## Project Structure

- `app.js` — Main server and route logic
- `database_setup.js` — Database schema and seed data
- `views/` — EJS templates
- `public/` — Static assets (CSS, images)
- `restaurant.db` — SQLite database

---

## Customization

- Update `database_setup.js` to add more sample data.
- Edit EJS templates in `views/pages/` for UI changes.

---

## License

MIT 