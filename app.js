const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

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

// Middleware to inject staffName and staffRole into res.locals for all views
app.use((req, res, next) => {
    res.locals.staffId = req.session.staffId || null;
    res.locals.staffName = req.session.staffName || null;
    res.locals.staffRole = req.session.staffRole || null;
    next();
});

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
        const twoHoursLater = new Date(new Date(dateTime).getTime() + 2 * 60 * 60 * 1000);
        
        db.all(
            `SELECT TableNumber FROM RESERVATIONS 
            WHERE DateTime BETWEEN ? AND ? 
            AND Status != 'Cancelled' 
            AND Status != 'Completed'`,
            [dateTime, twoHoursLater.toISOString()],
            (err, reservations) => {
                if (err) reject(err);
                else {
                    // Get all tables (1-10)
                    const allTables = Array.from({length: 10}, (_, i) => i + 1);
                    // Get occupied tables
                    const occupiedTables = new Set(reservations.map(r => r.TableNumber));
                    // Find first available table
                    const availableTable = allTables.find(table => !occupiedTables.has(table));
                    resolve(availableTable);
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
        const availableTable = await checkTableAvailability(dateTime, num_guests);
        
        if (!availableTable) {
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

                    // Insert reservation with available table
                    db.run(
                        'INSERT INTO RESERVATIONS (CustomerID, TableNumber, DateTime, NumberOfGuests) VALUES (?, ?, ?, ?)',
                        [customerId, availableTable, dateTime, num_guests],
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

    db.get(
        'SELECT * FROM STAFF WHERE Username = ?',
        [username],
        (err, staff) => {
            if (err || !staff) {
                return res.render('pages/staff_login', {
                    error: 'Invalid username or password'
                });
            }

            // Compare password with stored hash
            if (bcrypt.compareSync(password, staff.PasswordHash)) {
                req.session.staffId = staff.StaffID;
                req.session.staffRole = staff.Role;
                req.session.staffName = staff.Name;
                res.redirect('/staff/dashboard');
            } else {
                res.render('pages/staff_login', {
                    error: 'Invalid username or password'
                });
            }
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
    // Get query parameters for messages
    const success = req.query.success || null;
    const error = req.query.error || null;
    const message = req.query.message || null;
    
    // Get today's date in local timezone
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    console.log('Loading dashboard for date:', todayStr);
    
    // Get the start and end of today in ISO format
    const startOfDay = new Date(today.setHours(0, 0, 0, 0)).toISOString();
    const endOfDay = new Date(today.setHours(23, 59, 59, 999)).toISOString();
    console.log('Date range:', { startOfDay, endOfDay });
    
    db.all(
        `SELECT r.*, c.Name as CustomerName 
        FROM RESERVATIONS r 
        JOIN CUSTOMERS c ON r.CustomerID = c.CustomerID 
        WHERE r.DateTime BETWEEN ? AND ?
        ORDER BY r.DateTime`,
        [startOfDay, endOfDay],
        (err, reservations) => {
            if (err) {
                console.error('Error fetching reservations:', err);
                reservations = [];
            }

            console.log('Fetched reservations:', reservations.length);

            db.all(
                `SELECT o.*, s.Name as StaffName 
                FROM ORDERS o 
                JOIN STAFF s ON o.StaffID = s.StaffID 
                WHERE o.OrderDateTime BETWEEN ? AND ?
                ORDER BY o.OrderDateTime DESC`,
                [startOfDay, endOfDay],
                (err, orders) => {
                    if (err) {
                        console.error('Error fetching orders:', err);
                        orders = [];
                    }

                    console.log('Fetched orders:', orders.length);
                    if (orders.length > 0) {
                        console.log('Sample order data:', orders[0]);
                    }

                    res.render('pages/staff_dashboard', {
                        reservations,
                        orders,
                        success,
                        error,
                        message
                    });
                }
            );
        }
    );
});

// Manage reservations
app.get('/staff/reservations', requireLogin, (req, res) => {
    db.all(`
        SELECT r.*, c.Name as CustomerName 
        FROM RESERVATIONS r 
        LEFT JOIN CUSTOMERS c ON r.CustomerID = c.CustomerID 
        ORDER BY r.DateTime DESC
    `, (err, reservations) => {
        if (err) {
            console.error(err);
            return res.render('pages/manage_reservations', { 
                reservations: [], 
                error: "Could not fetch reservations." 
            });
        }
        res.render('pages/manage_reservations', { 
            reservations, 
            error: null 
        });
    });
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

// Delete reservation
app.post('/staff/reservation/delete/:id', requireLogin, (req, res) => {
    const reservationId = req.params.id;
    
    // First check if the reservation exists
    db.get('SELECT * FROM RESERVATIONS WHERE ReservationID = ?', [reservationId], (err, reservation) => {
        if (err) {
            console.error('Error checking reservation:', err);
            return res.status(500).send('Error checking reservation');
        }
        
        if (!reservation) {
            return res.status(404).send('Reservation not found');
        }

        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            // First delete any associated orders
            db.run(
                'DELETE FROM ORDERS WHERE ReservationID = ?',
                [reservationId],
                function(err) {
                    if (err) {
                        console.error('Error deleting associated orders:', err);
                        db.run('ROLLBACK');
                        return res.status(500).send('Error deleting associated orders');
                    }

                    // Then delete the reservation
                    db.run(
                        'DELETE FROM RESERVATIONS WHERE ReservationID = ?',
                        [reservationId],
                        function(err) {
                            if (err) {
                                console.error('Error deleting reservation:', err);
                                db.run('ROLLBACK');
                                return res.status(500).send('Error deleting reservation');
                            }

                            db.run('COMMIT');
                            res.redirect('/staff/reservations');
                        }
                    );
                }
            );
        });
    });
});

// Manage orders
app.get('/staff/orders', requireLogin, (req, res) => {
    db.all(`
        SELECT o.*, s.Name as StaffName 
        FROM ORDERS o 
        LEFT JOIN STAFF s ON o.StaffID = s.StaffID 
        ORDER BY o.OrderDateTime DESC
    `, (err, orders) => {
        if (err) {
            console.error(err);
            return res.render('pages/manage_orders', { 
                orders: [], 
                error: "Could not fetch orders." 
            });
        }
        res.render('pages/manage_orders', { 
            orders, 
            error: null 
        });
    });
});

// Delete order
app.post('/staff/order/delete/:id', requireLogin, (req, res) => {
    const orderId = req.params.id;
    
    // First check if the order exists
    db.get('SELECT * FROM ORDERS WHERE OrderID = ?', [orderId], (err, order) => {
        if (err) {
            console.error('Error checking order:', err);
            return res.status(500).send('Error checking order');
        }
        
        if (!order) {
            return res.status(404).send('Order not found');
        }

        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            // First delete all associated order items
            db.run(
                'DELETE FROM ORDER_ITEMS WHERE OrderID = ?',
                [orderId],
                function(err) {
                    if (err) {
                        console.error('Error deleting order items:', err);
                        db.run('ROLLBACK');
                        return res.status(500).send('Error deleting order items');
                    }

                    // Then delete the order
                    db.run(
                        'DELETE FROM ORDERS WHERE OrderID = ?',
                        [orderId],
                        function(err) {
                            if (err) {
                                console.error('Error deleting order:', err);
                                db.run('ROLLBACK');
                                return res.status(500).send('Error deleting order');
                            }

                            db.run('COMMIT');
                            res.redirect('/staff/orders');
                        }
                    );
                }
            );
        });
    });
});

// Create new order
app.get('/staff/order/new', requireLogin, (req, res) => {
    db.all('SELECT * FROM MENU_ITEMS ORDER BY Category, Name', (err, menuItems) => {
        if (err) {
            console.error(err);
            return res.render('pages/order_form', { 
                order: null, 
                menuItems: [], 
                error: "Could not fetch menu items." 
            });
        }
        
        if (menuItems.length === 0) {
            return res.render('pages/order_form', {
                order: null,
                menuItems: [],
                error: "No menu items available. Please add menu items first."
            });
        }
        
        res.render('pages/order_form', { 
            order: { items: [] }, 
            menuItems, 
            error: null 
        });
    });
});

// Edit order
app.get('/staff/order/edit/:order_id', requireLogin, (req, res) => {
    console.log('Editing order:', req.params.order_id);
    
    db.get(`
        SELECT o.* 
        FROM ORDERS o
        WHERE o.OrderID = ?
    `, [req.params.order_id], (err, order) => {
        if (err) {
            console.error('Error fetching order:', err);
            return res.render('pages/order_form', { 
                order: null, 
                menuItems: [], 
                error: "Could not fetch order details." 
            });
        }
        
        if (!order) {
            console.error('Order not found:', req.params.order_id);
            return res.render('pages/order_form', { 
                order: null, 
                menuItems: [], 
                error: "Order not found." 
            });
        }
        
        console.log('Order found:', order);
        
        // Get order items separately
        db.all(`
            SELECT oi.*, m.Name as MenuItemName, m.Price
            FROM ORDER_ITEMS oi
            JOIN MENU_ITEMS m ON oi.MenuItemID = m.MenuItemID
            WHERE oi.OrderID = ?
        `, [req.params.order_id], (err, orderItems) => {
            if (err) {
                console.error('Error fetching order items:', err);
                return res.render('pages/order_form', { 
                    order: null, 
                    menuItems: [], 
                    error: "Could not fetch order items." 
                });
            }
            
            console.log('Order items found:', orderItems);
            order.items = orderItems.map(item => ({
                MenuItemID: item.MenuItemID,
                Quantity: item.Quantity,
                SpecialRequests: item.SpecialRequests || '',
                Price: item.Price || 0  // Get price from menu item
            }));
            
            db.all('SELECT * FROM MENU_ITEMS ORDER BY Category, Name', (err, menuItems) => {
                if (err) {
                    console.error('Error fetching menu items:', err);
                    return res.render('pages/order_form', { 
                        order, 
                        menuItems: [], 
                        error: "Could not fetch menu items." 
                    });
                }
                
                if (menuItems.length === 0) {
                    return res.render('pages/order_form', {
                        order,
                        menuItems: [],
                        error: "No menu items available. Please add menu items first."
                    });
                }
                
                res.render('pages/order_form', { 
                    order, 
                    menuItems, 
                    error: null 
                });
            });
        });
    });
});

// Save/update order
app.post('/staff/order/save', requireLogin, (req, res) => {
    console.log('Saving order - Request body:', JSON.stringify(req.body, null, 2));
    const { tableNumber, status, orderId } = req.body;
    console.log('Extracted values:', { tableNumber, status, orderId });
    const staffId = req.session.staffId;
    console.log('Staff ID:', staffId);
    
    // Convert items object to array
    const itemsObj = req.body.items || {};
    console.log('Items object:', JSON.stringify(itemsObj, null, 2));
    
    // Check if items exist
    if (Object.keys(itemsObj).length === 0) {
        console.error('No items in the order');
        return res.redirect('/staff/dashboard?error=no_items');
    }
    
    const items = Object.keys(itemsObj).map(key => {
        return {
            menuItemId: itemsObj[key].menuItemId,
            quantity: itemsObj[key].quantity,
            specialRequests: itemsObj[key].specialRequests || '',
            price: itemsObj[key].price
        };
    });
    console.log('Processed items:', JSON.stringify(items, null, 2));

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        // Update or insert order
        if (orderId) {
            // Update existing order
            console.log('Updating existing order:', orderId);
            const currentDateTime = new Date().toISOString();
            db.run(
                'UPDATE ORDERS SET TableNumber = ?, Status = ?, OrderDateTime = ? WHERE OrderID = ?',
                [tableNumber, status, currentDateTime, orderId],
                function(err) {
                    if (err) {
                        console.error('Error updating order:', err);
                        db.run('ROLLBACK');
                        return res.redirect('/staff/dashboard?error=update_failed');
                    }
                    
                    console.log('Order updated successfully with timestamp:', currentDateTime);
                    // Delete existing order items
                    db.run('DELETE FROM ORDER_ITEMS WHERE OrderID = ?', [orderId], (err) => {
                        if (err) {
                            console.error('Error deleting order items:', err);
                            db.run('ROLLBACK');
                            return res.redirect('/staff/dashboard?error=update_failed');
                        }
                        
                        processOrderItems(orderId, items, 'Order updated successfully');
                    });
                }
            );
        } else {
            // Insert new order
            console.log('Creating new order');
            const currentDateTime = new Date().toISOString();
            db.run(
                'INSERT INTO ORDERS (StaffID, TableNumber, Status, OrderDateTime) VALUES (?, ?, ?, ?)',
                [staffId, tableNumber, status, currentDateTime],
                function(err) {
                    if (err) {
                        console.error('Error inserting order:', err);
                        db.run('ROLLBACK');
                        return res.redirect('/staff/dashboard?error=create_failed');
                    }

                    const newOrderId = this.lastID;
                    console.log('New order created with ID:', newOrderId, 'and timestamp:', currentDateTime);
                    processOrderItems(newOrderId, items, 'Order created successfully');
                }
            );
        }

        // Helper function to process order items and complete the transaction
        function processOrderItems(currentOrderId, orderItems, successMessage) {
            let totalPrice = 0;

            // Insert order items
            const insertItems = orderItems.map(item => {
                return new Promise((resolve, reject) => {
                    try {
                        // Validate item data
                        if (!item.menuItemId) {
                            throw new Error(`Missing menuItemId for item: ${JSON.stringify(item)}`);
                        }
                        if (!item.quantity) {
                            throw new Error(`Missing quantity for item: ${JSON.stringify(item)}`);
                        }
                        if (!item.price) {
                            throw new Error(`Missing price for item: ${JSON.stringify(item)}`);
                        }
                        
                        const menuItemId = parseInt(item.menuItemId);
                        const quantity = parseInt(item.quantity);
                        const price = parseFloat(item.price);
                        const specialRequests = item.specialRequests || '';
                        
                        if (isNaN(menuItemId) || menuItemId <= 0) {
                            throw new Error(`Invalid menuItemId: ${item.menuItemId}`);
                        }
                        if (isNaN(quantity) || quantity <= 0) {
                            throw new Error(`Invalid quantity: ${item.quantity}`);
                        }
                        if (isNaN(price) || price < 0) {
                            throw new Error(`Invalid price: ${item.price}`);
                        }
                        
                        const subtotal = price * quantity;
                        totalPrice += subtotal;

                        console.log('Inserting order item:', {
                            orderId: currentOrderId,
                            menuItemId,
                            quantity,
                            specialRequests,
                            subtotal
                        });

                        // Remove the Price column from the insertion
                        db.run(
                            'INSERT INTO ORDER_ITEMS (OrderID, MenuItemID, Quantity, SpecialRequests, Subtotal) VALUES (?, ?, ?, ?, ?)',
                            [currentOrderId, menuItemId, quantity, specialRequests, subtotal],
                            (err) => {
                                if (err) {
                                    console.error('Error inserting order item:', err);
                                    reject(err);
                                } else {
                                    resolve();
                                }
                            }
                        );
                    } catch (error) {
                        console.error('Error processing order item:', error);
                        reject(error);
                    }
                });
            });

            Promise.all(insertItems)
                .then(() => {
                    // Update order total
                    console.log('All items processed, updating order total:', totalPrice);
                    db.run(
                        'UPDATE ORDERS SET TotalPrice = ? WHERE OrderID = ?',
                        [totalPrice, currentOrderId],
                        (err) => {
                            if (err) {
                                console.error('Error updating order total:', err);
                                db.run('ROLLBACK');
                                return res.redirect('/staff/dashboard?error=total_update_failed');
                            }
                            console.log('Transaction committed, redirecting to dashboard');
                            db.run('COMMIT');
                            res.redirect(`/staff/dashboard?success=${encodeURIComponent(successMessage)}`);
                        }
                    );
                })
                .catch(err => {
                    console.error('Error inserting order items:', err);
                    db.run('ROLLBACK');
                    res.redirect(`/staff/dashboard?error=items_failed&message=${encodeURIComponent(err.message)}`);
                });
        }
    });
});

// View menu
app.get('/staff/menu', requireLogin, (req, res) => {
    db.all('SELECT * FROM MENU_ITEMS ORDER BY Category, Name', (err, menuItems) => {
        if (err) {
            console.error(err);
            return res.render('pages/view_menu', { 
                menuItems: [], 
                error: "Could not fetch menu items." 
            });
        }
        res.render('pages/view_menu', { 
            menuItems, 
            error: null 
        });
    });
});

// Kitchen display
app.get('/staff/kitchen', requireLogin, (req, res) => {
    db.all(`
        SELECT o.*, s.Name as StaffName,
               GROUP_CONCAT(m.Name || ' (x' || oi.Quantity || ')' || 
                           CASE WHEN oi.SpecialRequests IS NOT NULL 
                                THEN ' - Note: ' || oi.SpecialRequests 
                                ELSE '' END) as items
        FROM ORDERS o
        LEFT JOIN STAFF s ON o.StaffID = s.StaffID
        LEFT JOIN ORDER_ITEMS oi ON o.OrderID = oi.OrderID
        LEFT JOIN MENU_ITEMS m ON oi.MenuItemID = m.MenuItemID
        WHERE o.Status IN ('Placed', 'Ready for Kitchen', 'Preparing')
        GROUP BY o.OrderID
        ORDER BY o.OrderDateTime ASC
    `, (err, orders) => {
        if (err) {
            console.error(err);
            return res.render('pages/kitchen_display', { 
                orders: [], 
                error: "Could not fetch orders." 
            });
        }
        res.render('pages/kitchen_display', { 
            orders, 
            error: null 
        });
    });
});

// Update kitchen order status
app.post('/staff/order/update_kitchen_status/:order_id', requireLogin, (req, res) => {
    const { status } = req.body;
    const orderId = req.params.order_id;

    db.run(
        'UPDATE ORDERS SET Status = ? WHERE OrderID = ?',
        [status, orderId],
        (err) => {
            if (err) {
                console.error('Error updating order status:', err);
            }
            res.redirect('/staff/kitchen');
        }
    );
});

// Inventory management
app.get('/staff/inventory', requireLogin, (req, res) => {
    db.all(`
        SELECT i.*, s.Name as SupplierName 
        FROM INVENTORY_ITEMS i 
        LEFT JOIN SUPPLIERS s ON i.SupplierID = s.SupplierID 
        ORDER BY i.ItemName
    `, (err, inventory) => {
        if (err) {
            console.error(err);
            return res.render('pages/manage_inventory', { 
                inventory: [], 
                error: "Could not fetch inventory items." 
            });
        }
        console.log('Fetched inventory:', inventory);
        res.render('pages/manage_inventory', { 
            inventory, 
            error: null 
        });
    });
});

app.get('/staff/inventory/new', requireLogin, (req, res) => {
    db.all('SELECT * FROM SUPPLIERS ORDER BY Name', (err, suppliers) => {
        if (err) {
            console.error('Error fetching suppliers:', err);
            suppliers = [];
        }
        res.render('pages/inventory_form', {
            item: null,
            suppliers,
            isNew: true
        });
    });
});

app.post('/staff/inventory/add', requireLogin, (req, res) => {
    const { itemName, description, quantityOnHand, unit, reorderLevel, supplierId } = req.body;

    db.run(
        `INSERT INTO INVENTORY_ITEMS 
        (ItemName, Description, QuantityOnHand, Unit, ReorderLevel, SupplierID) 
        VALUES (?, ?, ?, ?, ?, ?)`,
        [itemName, description, quantityOnHand, unit, reorderLevel, supplierId || null],
        (err) => {
            if (err) {
                console.error('Error adding inventory item:', err);
            }
            res.redirect('/staff/inventory');
        }
    );
});

app.get('/staff/inventory/edit/:item_id', requireLogin, (req, res) => {
    const itemId = req.params.item_id;

    Promise.all([
        new Promise((resolve, reject) => {
            db.get('SELECT * FROM INVENTORY_ITEMS WHERE ItemID = ?', [itemId], (err, item) => {
                if (err) reject(err);
                else resolve(item);
            });
        }),
        new Promise((resolve, reject) => {
            db.all('SELECT * FROM SUPPLIERS ORDER BY Name', (err, suppliers) => {
                if (err) reject(err);
                else resolve(suppliers);
            });
        })
    ])
    .then(([item, suppliers]) => {
        res.render('pages/inventory_form', {
            item,
            suppliers,
            isNew: false
        });
    })
    .catch(err => {
        console.error('Error fetching inventory item:', err);
        res.redirect('/staff/inventory');
    });
});

app.post('/staff/inventory/update/:item_id', requireLogin, (req, res) => {
    const itemId = req.params.item_id;
    const { itemName, description, quantityOnHand, unit, reorderLevel, supplierId } = req.body;

    db.run(
        `UPDATE INVENTORY_ITEMS 
        SET ItemName = ?, Description = ?, QuantityOnHand = ?, 
            Unit = ?, ReorderLevel = ?, SupplierID = ? 
        WHERE ItemID = ?`,
        [itemName, description, quantityOnHand, unit, reorderLevel, supplierId || null, itemId],
        (err) => {
            if (err) {
                console.error('Error updating inventory item:', err);
            }
            res.redirect('/staff/inventory');
        }
    );
});

// Staff scheduling routes
// Manager routes
app.get('/staff/schedule/manage', requireLogin, (req, res) => {
    db.all('SELECT StaffID, Name FROM STAFF ORDER BY Name', (err, staff) => {
        if (err) {
            console.error(err);
            return res.render('pages/manage_schedule', {
                shifts: [],
                staff: [],
                error: 'Could not fetch staff list.'
            });
        }
        db.all('SELECT * FROM SHIFTS ORDER BY StartDateTime ASC', (err2, shiftsRaw) => {
            if (err2) {
                console.error(err2);
                return res.render('pages/manage_schedule', {
                    shifts: [],
                    staff,
                    error: 'Could not fetch shifts.'
                });
            }
            // For each shift, fetch assignments
            const shiftIds = shiftsRaw.map(s => s.ShiftID);
            if (shiftIds.length === 0) {
                return res.render('pages/manage_schedule', {
                    shifts: [],
                    staff,
                    error: null
                });
            }
            db.all(`SELECT ss.*, st.Name as StaffName FROM STAFF_SHIFTS ss JOIN STAFF st ON ss.StaffID = st.StaffID WHERE ss.ShiftID IN (${shiftIds.map(() => '?').join(',')})`, shiftIds, (err3, assignmentsRaw) => {
                if (err3) {
                    console.error(err3);
                    return res.render('pages/manage_schedule', {
                        shifts: [],
                        staff,
                        error: 'Could not fetch assignments.'
                    });
                }
                // Group assignments by shift
                const assignmentsByShift = {};
                assignmentsRaw.forEach(a => {
                    if (!assignmentsByShift[a.ShiftID]) assignmentsByShift[a.ShiftID] = [];
                    assignmentsByShift[a.ShiftID].push(a);
                });
                // Attach assignments to shifts
                const shifts = shiftsRaw.map(shift => ({
                    ...shift,
                    assignments: assignmentsByShift[shift.ShiftID] || []
                }));
                res.render('pages/manage_schedule', {
                    shifts,
                    staff,
                    error: null
                });
            });
        });
    });
});

app.get('/staff/schedule/shift/new', requireLogin, (req, res) => {
    res.render('pages/shift_form', { 
        isNew: true, 
        shift: null, 
        error: null 
    });
});

app.post('/staff/schedule/shift/create', requireLogin, (req, res) => {
    const { start_datetime, end_datetime, role_required } = req.body;

    // Validation
    if (!start_datetime || !end_datetime) {
        return res.render('pages/shift_form', {
            isNew: true,
            shift: req.body,
            error: 'Start and end times are required'
        });
    }

    const start = new Date(start_datetime);
    const end = new Date(end_datetime);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.render('pages/shift_form', {
            isNew: true,
            shift: req.body,
            error: 'Invalid date format'
        });
    }

    if (end <= start) {
        return res.render('pages/shift_form', {
            isNew: true,
            shift: req.body,
            error: 'End time must be after start time'
        });
    }

    // Insert into database
    db.run(
        `INSERT INTO SHIFTS (StartDateTime, EndDateTime, RoleRequired) 
         VALUES (?, ?, ?)`,
        [start_datetime, end_datetime, role_required || null],
        function(err) {
            if (err) {
                console.error('Error creating shift:', err);
                return res.render('pages/shift_form', {
                    isNew: true,
                    shift: req.body,
                    error: 'Failed to create shift. Please try again.'
                });
            }

            // Redirect to manage schedule page
            res.redirect('/staff/schedule/manage');
        }
    );
});

app.get('/staff/schedule/shift/edit/:shift_id', requireLogin, (req, res) => {
    db.get('SELECT * FROM SHIFTS WHERE ShiftID = ?', [req.params.shift_id], (err, shift) => {
        if (err) {
            console.error(err);
            return res.render('pages/shift_form', { 
                isNew: false, 
                shift: null, 
                error: "Could not fetch shift details." 
            });
        }
        res.render('pages/shift_form', { 
            isNew: false, 
            shift, 
            error: null 
        });
    });
});

app.post('/staff/schedule/shift/update/:shift_id', requireLogin, (req, res) => {
    const { start_datetime, end_datetime, role_required } = req.body;
    const shiftId = req.params.shift_id;

    db.run(
        'UPDATE SHIFTS SET StartDateTime = ?, EndDateTime = ?, RoleRequired = ? WHERE ShiftID = ?',
        [start_datetime, end_datetime, role_required, shiftId],
        (err) => {
            if (err) {
                console.error('Error updating shift:', err);
            }
            res.redirect('/staff/schedule/manage');
        }
    );
});

app.post('/staff/schedule/assign_staff_to_shift', requireLogin, (req, res) => {
    const { staff_id, shift_id } = req.body;

    // Check for overlapping shifts
    db.get(
        `SELECT ss.*, s.StartDateTime, s.EndDateTime
        FROM STAFF_SHIFTS ss
        JOIN SHIFTS s ON ss.ShiftID = s.ShiftID
        WHERE ss.StaffID = ? AND ss.ManagerApprovalStatus != 'Denied'`,
        [staff_id],
        (err, existingShift) => {
            if (err) {
                console.error('Error checking for overlapping shifts:', err);
                return res.redirect('/staff/schedule/manage');
            }

            if (existingShift) {
                // Basic overlap check - could be more sophisticated
                db.get(
                    'SELECT * FROM SHIFTS WHERE ShiftID = ?',
                    [shift_id],
                    (err, newShift) => {
                        if (err || !newShift) {
                            return res.redirect('/staff/schedule/manage');
                        }

                        const existingStart = new Date(existingShift.StartDateTime);
                        const existingEnd = new Date(existingShift.EndDateTime);
                        const newStart = new Date(newShift.StartDateTime);
                        const newEnd = new Date(newShift.EndDateTime);

                        if (newStart < existingEnd && newEnd > existingStart) {
                            // Overlap detected
                            return res.redirect('/staff/schedule/manage');
                        }

                        // No overlap, proceed with assignment
                        assignStaffToShift(staff_id, shift_id, res);
                    }
                );
            } else {
                // No existing shifts, proceed with assignment
                assignStaffToShift(staff_id, shift_id, res);
            }
        }
    );
});

function assignStaffToShift(staff_id, shift_id, res) {
    db.run(
        'INSERT INTO STAFF_SHIFTS (StaffID, ShiftID, ManagerApprovalStatus) VALUES (?, ?, ?)',
        [staff_id, shift_id, 'Approved'],
        (err) => {
            if (err) {
                console.error('Error assigning staff to shift:', err);
            }
            res.redirect('/staff/schedule/manage');
        }
    );
}

app.post('/staff/schedule/approve_request/:staff_shift_id', requireLogin, (req, res) => {
    const staffShiftId = req.params.staff_shift_id;

    db.run(
        'UPDATE STAFF_SHIFTS SET ManagerApprovalStatus = ? WHERE StaffShiftID = ?',
        ['Approved', staffShiftId],
        (err) => {
            if (err) {
                console.error('Error approving shift request:', err);
            }
            res.redirect('/staff/schedule/manage');
        }
    );
});

app.post('/staff/schedule/deny_request/:staff_shift_id', requireLogin, (req, res) => {
    const staffShiftId = req.params.staff_shift_id;

    db.run(
        'UPDATE STAFF_SHIFTS SET ManagerApprovalStatus = ? WHERE StaffShiftID = ?',
        ['Denied', staffShiftId],
        (err) => {
            if (err) {
                console.error('Error denying shift request:', err);
            }
            res.redirect('/staff/schedule/manage');
        }
    );
});

// General staff routes
app.get('/staff/my-schedule', requireLogin, (req, res) => {
    db.all(`
        SELECT s.*, ss.ManagerApprovalStatus
        FROM SHIFTS s
        JOIN STAFF_SHIFTS ss ON s.ShiftID = ss.ShiftID
        WHERE ss.StaffID = ?
        ORDER BY s.StartDateTime ASC
    `, [req.session.staffId], (err, shiftsRaw) => {
        if (err) {
            console.error(err);
            return res.render('pages/my_schedule', {
                shifts: [],
                error: 'Could not fetch your schedule.'
            });
        }
        // Format shifts for display
        const shifts = shiftsRaw.map(shift => ({
            ...shift,
            startDate: new Date(shift.StartDateTime).toLocaleDateString(),
            startTime: new Date(shift.StartDateTime).toLocaleTimeString(),
            endTime: new Date(shift.EndDateTime).toLocaleTimeString()
        }));
        res.render('pages/my_schedule', {
            shifts,
            error: null
        });
    });
});

// Delete shift
app.post('/staff/schedule/shift/delete/:shift_id', requireLogin, (req, res) => {
    const shiftId = req.params.shift_id;
    
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        // First delete all staff assignments for this shift
        db.run(
            'DELETE FROM STAFF_SHIFTS WHERE ShiftID = ?',
            [shiftId],
            function(err) {
                if (err) {
                    console.error('Error deleting staff assignments:', err);
                    db.run('ROLLBACK');
                    return res.status(500).send('Error deleting staff assignments');
                }
                
                // Then delete the shift
                db.run(
                    'DELETE FROM SHIFTS WHERE ShiftID = ?',
                    [shiftId],
                    function(err) {
                        if (err) {
                            console.error('Error deleting shift:', err);
                            db.run('ROLLBACK');
                            return res.status(500).send('Error deleting shift');
                        }
                        
                        db.run('COMMIT');
                        res.redirect('/staff/schedule/manage');
                    }
                );
            }
        );
    });
});

// Unassign staff from shift
app.post('/staff/schedule/unassign/:staff_shift_id', requireLogin, (req, res) => {
    const staffShiftId = req.params.staff_shift_id;
    
    db.run(
        'DELETE FROM STAFF_SHIFTS WHERE StaffShiftID = ?',
        [staffShiftId],
        function(err) {
            if (err) {
                console.error('Error unassigning staff:', err);
            }
            res.redirect('/staff/schedule/manage');
        }
    );
});

// Assign staff to shift
app.post('/staff/schedule/assign', requireLogin, (req, res) => {
    const { staff_id, shift_id } = req.body;
    
    // Check for overlapping shifts
    db.get(
        `SELECT ss.*, s.StartDateTime, s.EndDateTime
        FROM STAFF_SHIFTS ss
        JOIN SHIFTS s ON ss.ShiftID = s.ShiftID
        WHERE ss.StaffID = ? AND ss.ManagerApprovalStatus != 'Denied'`,
        [staff_id],
        (err, existingShift) => {
            if (err) {
                console.error('Error checking for overlapping shifts:', err);
                return res.redirect('/staff/schedule/manage');
            }
            
            if (existingShift) {
                // Get the new shift details
                db.get(
                    'SELECT * FROM SHIFTS WHERE ShiftID = ?',
                    [shift_id],
                    (err, newShift) => {
                        if (err || !newShift) {
                            return res.redirect('/staff/schedule/manage');
                        }
                        
                        const existingStart = new Date(existingShift.StartDateTime);
                        const existingEnd = new Date(existingShift.EndDateTime);
                        const newStart = new Date(newShift.StartDateTime);
                        const newEnd = new Date(newShift.EndDateTime);
                        
                        if (newStart < existingEnd && newEnd > existingStart) {
                            // Overlap detected
                            return res.redirect('/staff/schedule/manage');
                        }
                        
                        // No overlap, proceed with assignment
                        assignStaffToShift(staff_id, shift_id, res);
                    }
                );
            } else {
                // No existing shifts, proceed with assignment
                assignStaffToShift(staff_id, shift_id, res);
            }
        }
    );
});

// Temporary route to check database schema
app.get('/debug/schema', (req, res) => {
    db.all("SELECT sql FROM sqlite_master WHERE type='table'", (err, tables) => {
        if (err) {
            return res.send('Error fetching schema: ' + err.message);
        }
        
        // Get a sample order to check data
        db.get("SELECT * FROM ORDERS LIMIT 1", (err, order) => {
            let orderData = err ? 'Error: ' + err.message : order;
            
            res.send(`
                <h1>Database Schema</h1>
                <pre>${JSON.stringify(tables, null, 2)}</pre>
                <h2>Sample Order</h2>
                <pre>${JSON.stringify(orderData, null, 2)}</pre>
            `);
        });
    });
});

// Update order status directly
app.post('/staff/order/update_status/:order_id', requireLogin, (req, res) => {
    const { status } = req.body;
    const orderId = req.params.order_id;
    const currentDateTime = new Date().toISOString();

    console.log('Updating order status:', { orderId, status, currentDateTime });

    db.run(
        'UPDATE ORDERS SET Status = ?, OrderDateTime = ? WHERE OrderID = ?',
        [status, currentDateTime, orderId],
        (err) => {
            if (err) {
                console.error('Error updating order status:', err);
                return res.redirect('/staff/dashboard?error=status_update_failed');
            }
            res.redirect(`/staff/dashboard?success=${encodeURIComponent('Order status updated to ' + status)}`);
        }
    );
});

// Start server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
}); 