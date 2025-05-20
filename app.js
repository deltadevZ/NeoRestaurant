const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Database connection
const db = new sqlite3.Database(path.join(__dirname, 'restaurant.db'), (err) => {
    if (err) {
        console.error('Error connecting to database:', err);
        process.exit(1);
    }
    console.log('Connected to the restaurant database.');
});

// Enable foreign keys
db.run('PRAGMA foreign_keys = ON;');

// Middleware
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
    secret: 'your-secret-key', // Change this in production!
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Set to true if using HTTPS
}));

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Staff authentication middleware
const requireLogin = (req, res, next) => {
    if (req.session.staffId) {
        next();
    } else {
        res.redirect('/staff/login');
    }
};

// Helper function to check table availability
const checkTableAvailability = (dateTime, numGuests) => {
    return new Promise((resolve, reject) => {
        // Simple availability check - can be enhanced
        const twoHoursLater = new Date(new Date(dateTime).getTime() + 2 * 60 * 60 * 1000);
        
        db.all(
            `SELECT * FROM RESERVATIONS 
            WHERE DateTime BETWEEN ? AND ? 
            AND Status != 'Cancelled' 
            AND Status != 'Completed'`,
            [dateTime, twoHoursLater.toISOString()],
            (err, reservations) => {
                if (err) reject(err);
                else {
                    // Simple logic: assume 10 tables, each seats 4
                    const occupiedTables = new Set(reservations.map(r => r.TableNumber));
                    const availableTables = [];
                    
                    for (let i = 1; i <= 10; i++) {
                        if (!occupiedTables.has(i)) {
                            availableTables.push(i);
                        }
                    }
                    
                    resolve(availableTables.length > 0);
                }
            }
        );
    });
};

// Routes

// Homepage
app.get('/', (req, res) => {
    res.render('pages/index');
});

// Reservation routes
app.get('/reserve', (req, res) => {
    res.render('pages/reserve', {
        date: req.query.date || '',
        time: req.query.time || '',
        num_guests: req.query.num_guests || '',
        error: null
    });
});

app.post('/reserve', async (req, res) => {
    const { date, time, num_guests, customer_name, customer_phone, customer_email } = req.body;
    const dateTime = `${date}T${time}:00`;

    try {
        const isAvailable = await checkTableAvailability(dateTime, num_guests);
        
        if (!isAvailable) {
            return res.render('pages/reserve', {
                date,
                time,
                num_guests,
                error: 'Sorry, no tables available for this time slot.'
            });
        }

        // Start transaction
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            // Insert customer
            db.run(
                'INSERT INTO CUSTOMERS (Name, Phone, Email) VALUES (?, ?, ?)',
                [customer_name, customer_phone, customer_email],
                function(err) {
                    if (err) {
                        db.run('ROLLBACK');
                        return res.render('pages/reserve', {
                            date,
                            time,
                            num_guests,
                            error: 'Error creating reservation. Please try again.'
                        });
                    }

                    const customerId = this.lastID;

                    // Insert reservation
                    db.run(
                        'INSERT INTO RESERVATIONS (CustomerID, TableNumber, DateTime, NumberOfGuests) VALUES (?, ?, ?, ?)',
                        [customerId, 1, dateTime, num_guests], // Simple table assignment
                        function(err) {
                            if (err) {
                                db.run('ROLLBACK');
                                return res.render('pages/reserve', {
                                    date,
                                    time,
                                    num_guests,
                                    error: 'Error creating reservation. Please try again.'
                                });
                            }

                            db.run('COMMIT');
                            res.redirect(`/reservation-confirmed/${this.lastID}`);
                        }
                    );
                }
            );
        });
    } catch (err) {
        console.error('Reservation error:', err);
        res.render('pages/reserve', {
            date,
            time,
            num_guests,
            error: 'An error occurred. Please try again.'
        });
    }
});

// Reservation confirmation
app.get('/reservation-confirmed/:id', (req, res) => {
    db.get(
        `SELECT r.*, c.Name, c.Phone, c.Email 
        FROM RESERVATIONS r 
        JOIN CUSTOMERS c ON r.CustomerID = c.CustomerID 
        WHERE r.ReservationID = ?`,
        [req.params.id],
        (err, reservation) => {
            if (err || !reservation) {
                return res.redirect('/');
            }
            res.render('pages/reservation_confirmed', { reservation });
        }
    );
});

// Staff login
app.get('/staff/login', (req, res) => {
    res.render('pages/staff_login', { error: null });
});

app.post('/staff/login', (req, res) => {
    const { username, password } = req.body;

    // WARNING: This is using plain text password comparison!
    // In production, use bcrypt.js for password hashing and comparison
    db.get(
        'SELECT * FROM STAFF WHERE Username = ? AND PasswordHash = ?',
        [username, password],
        (err, staff) => {
            if (err || !staff) {
                return res.render('pages/staff_login', {
                    error: 'Invalid username or password'
                });
            }

            req.session.staffId = staff.StaffID;
            res.redirect('/staff/dashboard');
        }
    );
});

// Staff logout
app.get('/staff/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/staff/login');
});

// Staff dashboard
app.get('/staff/dashboard', requireLogin, (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    
    db.all(
        `SELECT r.*, c.Name as CustomerName 
        FROM RESERVATIONS r 
        JOIN CUSTOMERS c ON r.CustomerID = c.CustomerID 
        WHERE date(r.DateTime) = ? 
        ORDER BY r.DateTime`,
        [today],
        (err, reservations) => {
            if (err) {
                console.error('Error fetching reservations:', err);
                reservations = [];
            }

            db.all(
                `SELECT o.*, s.Name as StaffName 
                FROM ORDERS o 
                JOIN STAFF s ON o.StaffID = s.StaffID 
                WHERE date(o.OrderDateTime) = ? 
                ORDER BY o.OrderDateTime`,
                [today],
                (err, orders) => {
                    if (err) {
                        console.error('Error fetching orders:', err);
                        orders = [];
                    }

                    res.render('pages/staff_dashboard', {
                        reservations,
                        orders
                    });
                }
            );
        }
    );
});

// Manage reservations
app.get('/staff/reservations', requireLogin, (req, res) => {
    db.all(
        `SELECT r.*, c.Name as CustomerName 
        FROM RESERVATIONS r 
        JOIN CUSTOMERS c ON r.CustomerID = c.CustomerID 
        WHERE r.DateTime >= datetime('now') 
        ORDER BY r.DateTime`,
        (err, reservations) => {
            if (err) {
                console.error('Error fetching reservations:', err);
                reservations = [];
            }
            res.render('pages/manage_reservations', { reservations });
        }
    );
});

// Update reservation status
app.post('/staff/reservation/update_status/:id', requireLogin, (req, res) => {
    const { status } = req.body;
    db.run(
        'UPDATE RESERVATIONS SET Status = ? WHERE ReservationID = ?',
        [status, req.params.id],
        (err) => {
            if (err) {
                console.error('Error updating reservation:', err);
            }
            res.redirect('/staff/reservations');
        }
    );
});

// Manage orders
app.get('/staff/orders', requireLogin, (req, res) => {
    db.all(
        `SELECT o.*, s.Name as StaffName 
        FROM ORDERS o 
        JOIN STAFF s ON o.StaffID = s.StaffID 
        ORDER BY o.OrderDateTime DESC`,
        (err, orders) => {
            if (err) {
                console.error('Error fetching orders:', err);
                orders = [];
            }
            res.render('pages/manage_orders', { orders });
        }
    );
});

// Create new order
app.get('/staff/order/new', requireLogin, (req, res) => {
    db.all('SELECT * FROM MENU_ITEMS ORDER BY Category, Name', (err, menuItems) => {
        if (err) {
            console.error('Error fetching menu items:', err);
            menuItems = [];
        }
        res.render('pages/order_form', { 
            order: null,
            menuItems,
            isNew: true
        });
    });
});

// Edit order
app.get('/staff/order/edit/:id', requireLogin, (req, res) => {
    db.get(
        `SELECT o.*, s.Name as StaffName 
        FROM ORDERS o 
        JOIN STAFF s ON o.StaffID = s.StaffID 
        WHERE o.OrderID = ?`,
        [req.params.id],
        (err, order) => {
            if (err || !order) {
                return res.redirect('/staff/orders');
            }

            db.all('SELECT * FROM MENU_ITEMS ORDER BY Category, Name', (err, menuItems) => {
                if (err) {
                    console.error('Error fetching menu items:', err);
                    menuItems = [];
                }

                db.all(
                    `SELECT oi.*, mi.Name, mi.Price 
                    FROM ORDER_ITEMS oi 
                    JOIN MENU_ITEMS mi ON oi.MenuItemID = mi.MenuItemID 
                    WHERE oi.OrderID = ?`,
                    [req.params.id],
                    (err, orderItems) => {
                        if (err) {
                            console.error('Error fetching order items:', err);
                            orderItems = [];
                        }
                        order.items = orderItems;
                        res.render('pages/order_form', {
                            order,
                            menuItems,
                            isNew: false
                        });
                    }
                );
            });
        }
    );
});

// Save/update order
app.post('/staff/order/save', requireLogin, (req, res) => {
    const { tableNumber, status, items } = req.body;
    const staffId = req.session.staffId;

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        // Insert order
        db.run(
            'INSERT INTO ORDERS (StaffID, TableNumber, Status) VALUES (?, ?, ?)',
            [staffId, tableNumber, status],
            function(err) {
                if (err) {
                    db.run('ROLLBACK');
                    return res.redirect('/staff/orders');
                }

                const orderId = this.lastID;
                let totalPrice = 0;

                // Insert order items
                const insertItems = items.map(item => {
                    return new Promise((resolve, reject) => {
                        const subtotal = item.price * item.quantity;
                        totalPrice += subtotal;

                        db.run(
                            'INSERT INTO ORDER_ITEMS (OrderID, MenuItemID, Quantity, SpecialRequests, Subtotal) VALUES (?, ?, ?, ?, ?)',
                            [orderId, item.menuItemId, item.quantity, item.specialRequests, subtotal],
                            (err) => {
                                if (err) reject(err);
                                else resolve();
                            }
                        );
                    });
                });

                Promise.all(insertItems)
                    .then(() => {
                        // Update order total
                        db.run(
                            'UPDATE ORDERS SET TotalPrice = ? WHERE OrderID = ?',
                            [totalPrice, orderId],
                            (err) => {
                                if (err) {
                                    db.run('ROLLBACK');
                                    return res.redirect('/staff/orders');
                                }
                                db.run('COMMIT');
                                res.redirect('/staff/orders');
                            }
                        );
                    })
                    .catch(err => {
                        console.error('Error inserting order items:', err);
                        db.run('ROLLBACK');
                        res.redirect('/staff/orders');
                    });
            }
        );
    });
});

// View menu
app.get('/staff/menu', requireLogin, (req, res) => {
    db.all('SELECT * FROM MENU_ITEMS ORDER BY Category, Name', (err, menuItems) => {
        if (err) {
            console.error('Error fetching menu items:', err);
            menuItems = [];
        }
        res.render('pages/view_menu', { menuItems });
    });
});

// Start server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
}); 