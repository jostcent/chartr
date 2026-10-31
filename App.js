import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import RecordScreen from './screens/RecordScreen';
import InboxScreen from './screens/InboxScreen';
import SettingsScreen from './screens/SettingsScreen';

const Tab = createBottomTabNavigator();

const TAB_ICONS = {
  Diktieren: 'mic-outline',
  Inbox: 'file-tray-outline',
  Einstellungen: 'settings-outline',
};

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarStyle: { backgroundColor: '#1a4a6e', borderTopWidth: 0 },
            tabBarActiveTintColor: '#2d8a7a',
            tabBarInactiveTintColor: 'rgba(255,255,255,0.45)',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name={TAB_ICONS[route.name]} size={size} color={color} />
            ),
          })}
        >
          <Tab.Screen
            name="Diktieren"
            component={RecordScreen}
            options={{ tabBarLabel: 'Diktieren' }}
          />
          <Tab.Screen
            name="Inbox"
            component={InboxScreen}
            options={{ tabBarLabel: 'Inbox' }}
          />
          <Tab.Screen
            name="Einstellungen"
            component={SettingsScreen}
            options={{ tabBarLabel: 'Einstellungen' }}
          />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
